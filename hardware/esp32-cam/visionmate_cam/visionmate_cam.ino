/**
 * VisionMate камер (AI Thinker ESP32-CAM, OV2640).
 *
 * Утасны hotspot-д холбогдож, аппад зураг өгнө:
 *   http://visionmate-cam.local/capture           JPEG кадр (640x480) — алхах горим
 *   http://visionmate-cam.local/capture?size=hi   тод кадр (1600x1200) — бичиг унших
 *   http://visionmate-cam.local/health            {"status":"ok"}
 *   http://visionmate-cam.local/                  шалгах хуудас (кадруудыг тасралтгүй харуулна)
 *
 * Wi-Fi-ийн нэр, нууц үгийг secrets.h-д бичнэ (secrets.h.example-ийг хуулж).
 * Анх USB-ээр суулгасны дараа шинэчлэлийг Wi-Fi-аар (OTA) хийнэ:
 *   arduino-cli upload -p visionmate-cam.local ...
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
  c.xclk_freq_hz = 20000000;
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
  esp_camera_sensor_get()->set_framesize(esp_camera_sensor_get(), FRAMESIZE_VGA);

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
