# Makes selfie_segmenter.onnx (the export's speaker cut-out, cutout.js) from
# Google's MediaPipe selfie segmenter, the same file the editor's preview
# uses (public/models/selfie_segmenter.tflite). Not run at build time; see
# README.md.
#
#   python -m venv cv && cv/Scripts/python -m pip install tensorflow-cpu onnx
#   cv/Scripts/python -m pip install --no-deps tf2onnx
#   cv/Scripts/python render-worker/models/convert.py

import subprocess
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

SRC = "public/models/selfie_segmenter.tflite"
OUT = "render-worker/models/selfie_segmenter.onnx"

subprocess.run(
    [sys.executable, "-m", "tf2onnx.convert", "--tflite", SRC, "--output", OUT, "--opset", "17"],
    check=True,
)

# tf2onnx leaves MediaPipe's custom last layer (Convolution2DTransposeBias:
# a 2x2, stride-2 transposed convolution plus a bias, which scales the mask
# up) as a placeholder; replace it with ONNX's ConvTranspose.
m = onnx.load(OUT)
g = m.graph
inits = {i.name: i for i in g.initializer}
node = next(n for n in g.node if n.op_type == "TFL_Convolution2DTransposeBias")
tr = next(n for n in g.node if node.input[0] in n.output)
assert list(next(a for a in tr.attribute if a.name == "perm").ints) == [0, 2, 3, 1]
w = numpy_helper.to_array(inits[node.input[1]])  # TFLite: out, kh, kw, in
b = numpy_helper.to_array(inits[node.input[2]])
g.initializer.append(numpy_helper.from_array(np.ascontiguousarray(w.transpose(3, 0, 1, 2)), "segment_ct_w"))
g.initializer.append(numpy_helper.from_array(b.astype(np.float32), "segment_ct_b"))
ct = helper.make_node(
    "ConvTranspose",
    [tr.input[0], "segment_ct_w", "segment_ct_b"],
    ["segment_nchw"],
    name="segment_convtranspose",
    kernel_shape=[2, 2],
    strides=[2, 2],
    pads=[0, 0, 0, 0],
)
back = helper.make_node("Transpose", ["segment_nchw"], [node.output[0]], name="segment_to_nhwc", perm=[0, 2, 3, 1])
i = list(g.node).index(node)
g.node.remove(node)
g.node.insert(i, back)
g.node.insert(i, ct)
if not any(tr.output[0] in n.input for n in g.node):
    g.node.remove(tr)
used = {x for n in g.node for x in n.input}
for init in list(g.initializer):
    if init.name not in used:
        g.initializer.remove(init)
onnx.checker.check_model(m)
onnx.save(m, OUT)
print("saved", OUT)
