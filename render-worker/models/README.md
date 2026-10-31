# Models

`selfie_segmenter.onnx` cuts the speaker out of the picture for graphics
behind the speaker (`../cutout.js`).

- Source: Google's MediaPipe selfie segmenter (Apache License 2.0),
  `selfie_segmenter.tflite` (float16) from
  `storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/`,
  the same file the editor's preview uses (`public/models/`).
  sha256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`.
- Converted with `convert.py` (tf2onnx 1.17.0, TensorFlow 2.21.0, opset 17),
  which also swaps MediaPipe's custom last layer for ONNX's ConvTranspose.
  sha256 `d5b32452ff6fda379ad4848b0dcbbbdfa7a1586f8c3188cab66f0937239bbbc1`.
- Input `input_1`: 1×256×256×3 RGB, 0-1. Output `activation_10`:
  1×256×256×1, the chance each pixel is the person.
