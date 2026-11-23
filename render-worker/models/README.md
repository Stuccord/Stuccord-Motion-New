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

`rvm_mobilenetv3_fp32.onnx` is the real video matte used instead when it's
there (`MATTING_MODEL` in `../cutout.js`): a soft alpha for every pixel
(hair strands, beard, fingers), steady over time.

- Source: Robust Video Matting by Shanchuan Lin et al., MobileNetV3, fp32
  ONNX, release v1.0.0 of github.com/PeterL1n/RobustVideoMatting.
  **Licence: GPL-3.0.** Running it on our own server is fine; giving the
  worker's code to others would bring GPL-3.0's terms with it.
- Not kept in the repository: the worker's Docker build downloads it and
  checks its sha256 (`Dockerfile`). To use it locally, put the file here.
- Inputs: `src` 1×3×H×W RGB 0-1, `r1i`..`r4i` the recurrent state
  (1×1×1×1 zeros to start), `downsample_ratio` [1]. Outputs: `fgr`, `pha`
  (1×1×H×W alpha 0-1), `r1o`..`r4o` (the next state).
