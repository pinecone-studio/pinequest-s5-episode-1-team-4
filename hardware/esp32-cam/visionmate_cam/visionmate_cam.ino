/**
 * VisionMate камер (AI Thinker ESP32-CAM, OV2640).
 *
 * Утасны hotspot-д холбогдож, аппад зураг өгнө:
 *   http://visionmate-cam.local/capture           JPEG кадр (640x480) — алхах горим
 *   http://visionmate-cam.local/capture?size=hi   тод кадр (1600x1200) — бичиг унших
 *   http://visionmate-cam.local/health            {"status":"ok"}
 *   http://visionmate-cam.local:81/stream         MJPEG урсгал (640x480) — кадр бүрд хүсэлт явуулахгүй
 *   http://visionmate-cam.local/                  шалгах хуудас (кадруудыг тасралтгүй харуулна)
 *
 * Wi-Fi-ийн нэр, нууц үгийг secrets.h-д бичнэ (secrets.h.example-ийг хуулж).
 * OTA-д хоёр app хуваалт хэрэгтэй, харин esp32cam-ын анхдагч "Huge APP"-д ганц л бий. Анх USB-ээр
 * min_spiffs хуваалттай суулгасны дараа шинэчлэлийг Wi-Fi-аар (OTA) хийнэ:
 *   arduino-cli compile -b esp32:esp32:esp32cam:PartitionScheme=min_spiffs ...
 *   arduino-cli upload -b esp32:esp32:esp32cam:PartitionScheme=min_spiffs -p visionmate-cam.local ...
 */
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WiFi.h>

#include "esp_camera.h"
#include "esp_http_server.h"
#include "secrets.h"

static const int FLASH_LED_PIN = 4;
static const char *HOSTNAME = "visionmate-cam";
static const int STALE_FRAMES = 2;  // хэмжээ солиход буферт үлдсэн хуучин кадрууд
static const int STREAM_PORT = 81;
// ~12 кадр/сек — Wi-Fi-г дүүргэвэл /capture, ping удааширна.
static const int STREAM_FRAME_MS = 80;
#define STREAM_BOUNDARY "visionmateframe"

static const char INDEX_HTML[] =
    "<!doctype html><meta name=viewport content='width=device-width'>"
    "<title>VisionMate Cam</title><body style='margin:0;background:#000'>"
    "<img id=f style='width:100%'><script>"
    "const f=document.getElementById('f');"
    "const next=()=>{f.src='/capture?t='+Date.now()};"
    "f.onload=f.onerror=()=>setTimeout(next,150);next();"
    "</script>";

/** AI Thinker ESP32-CAM-ын камерын хөлүүд. */
static camera_config_t cameraConfig() {
  camera_config_t c = {};
  c.pin_pwdn = 32;
  c.pin_reset = -1;
  c.pin_xclk = 0;
  c.pin_sccb_sda = 26;
  c.pin_sccb_scl = 27;
  c.pin_d7 = 35;
  c.pin_d6 = 34;
  c.pin_d5 = 39;
  c.pin_d4 = 36;
  c.pin_d3 = 21;
  c.pin_d2 = 19;
  c.pin_d1 = 18;
  c.pin_d0 = 5;
  c.pin_vsync = 25;
  c.pin_href = 23;
  c.pin_pclk = 22;
  // 20MHz-д камер PSRAM-ыг дүүргэж (FB-OVF), Wi-Fi-ийн хариу 1+ сек болдог. Аппад 10MHz хангалттай.
  c.xclk_freq_hz = 10000000;
  c.ledc_timer = LEDC_TIMER_0;
  c.ledc_channel = LEDC_CHANNEL_0;
  c.pixel_format = PIXFORMAT_JPEG;
  // Буферийг хамгийн том хэмжээгээр нөөцөлнө — эс бөгөөс тод кадр багтахгүй.
  c.frame_size = FRAMESIZE_UXGA;
  c.jpeg_quality = 12;
  c.fb_count = 2;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  // Хуучирсан кадр биш, хамгийн сүүлийнхийг өгнө — алхаж байхад чухал.
  c.grab_mode = CAMERA_GRAB_LATEST;
  return c;
}

/** Хүссэн хэмжээтэй шинэ кадр. Хэмжээ солигдвол өмнөх хэмжээтэй кадруудыг хаяна. */
static camera_fb_t *grabFrame(framesize_t size) {
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor->status.framesize != size) {
    sensor->set_framesize(sensor, size);
    for (int i = 0; i < STALE_FRAMES; i++) {
      camera_fb_t *stale = esp_camera_fb_get();
      if (stale) esp_camera_fb_return(stale);
    }
  }
  return esp_camera_fb_get();
}

/** ?size=hi — бичиг уншихад тод кадр; эс бөгөөс YOLO-д хангалттай 640px. */
static framesize_t requestedSize(httpd_req_t *req) {
  char query[32];
  char size[8];
  bool hi = httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK &&
            httpd_query_key_value(query, "size", size, sizeof(size)) == ESP_OK && strcmp(size, "hi") == 0;
  return hi ? FRAMESIZE_UXGA : FRAMESIZE_VGA;
}

static esp_err_t captureHandler(httpd_req_t *req) {
  camera_fb_t *frame = grabFrame(requestedSize(req));
  if (!frame) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  esp_err_t result = httpd_resp_send(req, (const char *)frame->buf, frame->len);
  esp_camera_fb_return(frame);
  return result;
}

/** Кадруудыг нэг холболтоор тасралтгүй илгээнэ — хүсэлт бүрийн холболт, Wi-Fi-ийн саатлыг хасна. */
static esp_err_t streamHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" STREAM_BOUNDARY);
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  char header[128];
  for (;;) {
    int64_t started = esp_timer_get_time();
    camera_fb_t *frame = grabFrame(FRAMESIZE_VGA);
    if (!frame) return ESP_FAIL;
    // Кадр авсан мөч (асаснаас хойш мс) — апп хоцролт хуримтлагдаж буйг үүгээр мэднэ.
    long long capturedMs = frame->timestamp.tv_sec * 1000LL + frame->timestamp.tv_usec / 1000;
    int length = snprintf(header, sizeof(header),
                          "\r\n--" STREAM_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n"
                          "X-Timestamp: %lld\r\n\r\n",
                          frame->len, capturedMs);
    esp_err_t result = httpd_resp_send_chunk(req, header, length);
    if (result == ESP_OK) result = httpd_resp_send_chunk(req, (const char *)frame->buf, frame->len);
    esp_camera_fb_return(frame);
    // Апп холболтоо хаавал энд дуусна.
    if (result != ESP_OK) return result;
    int64_t waitMs = STREAM_FRAME_MS - (esp_timer_get_time() - started) / 1000;
    if (waitMs > 0) vTaskDelay(pdMS_TO_TICKS(waitMs));
  }
}

static esp_err_t indexHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t healthHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, "{\"status\":\"ok\"}", HTTPD_RESP_USE_STRLEN);
}

static void startServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  // iPhone холболтоо нээлттэй үлдээдэг — сокет дүүрвэл шинэ хүсэлт хариугүй өлгөөтэй үлдэнэ.
  config.lru_purge_enable = true;
  // Wi-Fi-д пакет алдагдахад анхдагч 5 сек хүлээж, дараагийн бүх хүсэлт гацдаг байсан.
  config.recv_wait_timeout = 1;
  config.send_wait_timeout = 2;
  httpd_handle_t server = nullptr;
  if (httpd_start(&server, &config) != ESP_OK) {
    Serial.println("HTTP сервер асаагүй.");
    return;
  }
  const httpd_uri_t routes[] = {
      {"/", HTTP_GET, indexHandler, nullptr},
      {"/capture", HTTP_GET, captureHandler, nullptr},
      {"/health", HTTP_GET, healthHandler, nullptr},
  };
  for (const httpd_uri_t &route : routes) httpd_register_uri_handler(server, &route);

  // Урсгал серверийн даалгаврыг эзэлдэг тул тусдаа портод — /capture, /health хариулсаар байна.
  config.server_port = STREAM_PORT;
  config.ctrl_port += 1;
  httpd_handle_t streamServer = nullptr;
  if (httpd_start(&streamServer, &config) != ESP_OK) {
    Serial.println("Урсгалын сервер асаагүй.");
    return;
  }
  const httpd_uri_t stream = {"/stream", HTTP_GET, streamHandler, nullptr};
  httpd_register_uri_handler(streamServer, &stream);
}

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  // Унтах горим хариуг 100+ мс удаашруулдаг.
  WiFi.setSleep(false);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Wi-Fi \"%s\"-д холбогдож байна", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  camera_config_t config = cameraConfig();
  esp_err_t error = esp_camera_init(&config);
  if (error != ESP_OK) {
    Serial.printf("Камер асаагүй (0x%x). Кабелийг шалгана уу. 3 сек-ийн дараа дахин оролдоно.\n", error);
    delay(3000);
    ESP.restart();
  }
  sensor_t *sensor = esp_camera_sensor_get();
  sensor->set_framesize(sensor, FRAMESIZE_VGA);
  // Модуль толин тусгал шиг зураг өгдөг — эс бөгөөс зүүн/баруун сэрэмжлүүлэг солигдоно.
  sensor->set_hmirror(sensor, 1);

  connectWifi();
  // OTA нь mDNS-ийг (visionmate-cam.local) өөрөө асаана — апп камерыг энэ нэрээр олно.
  // Нууц үггүй бол ижил Wi-Fi-д байгаа хэн ч программыг солих боломжтой.
  ArduinoOTA.setHostname(HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.begin();
  MDNS.addService("http", "tcp", 80);
  startServer();
  Serial.printf("Бэлэн: http://%s/capture  (http://%s.local)\n", WiFi.localIP().toString().c_str(), HOSTNAME);
}

void loop() {
  static uint32_t lastWifiCheck = 0;
  ArduinoOTA.handle();
  // Hotspot түр унтарвал дахин холбогдоно.
  if (millis() - lastWifiCheck > 5000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
  }
  delay(10);
}
