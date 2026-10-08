#!/usr/bin/env bash
# YOLOX-S (Apache-2.0, Megvii) — COCO-ийн 80 төрлийн зүйл илрүүлэх model.
set -euo pipefail
cd "$(dirname "$0")/.."
URL="https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx"
OUT="models/yolox_s.onnx"
if [ -f "$OUT" ]; then echo "$OUT аль хэдийн байна."; exit 0; fi
mkdir -p models
curl -fL --progress-bar "$URL" -o "$OUT.part"
mv "$OUT.part" "$OUT"
echo "Татлаа: $OUT ($(du -h "$OUT" | cut -f1))"
