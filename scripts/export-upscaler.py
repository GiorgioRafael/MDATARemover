"""Export official Real-ESRGAN weights for local browser inference.

Build tooling only: pip install torch onnx onnxruntime
python scripts/export-upscaler.py
Architecture: xinntao/Real-ESRGAN, BSD-3-Clause (see public/models/LICENSE.txt).
"""
import hashlib
import json
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn
from torch.nn import functional as F

UPSTREAM = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/"
COMMIT = "a4abfb2979a7bbff3f69f58f58ae324608821e27"
DESTINATION = Path(__file__).resolve().parents[1] / "public" / "models"


class SRVGGNetCompact(nn.Module):
    def __init__(self):
        super().__init__()
        self.body = nn.ModuleList([nn.Conv2d(3, 64, 3, 1, 1), nn.PReLU(64)])
        for _ in range(32):
            self.body.extend([nn.Conv2d(64, 64, 3, 1, 1), nn.PReLU(64)])
        self.body.append(nn.Conv2d(64, 48, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(4)

    def forward(self, pixels):
        output = pixels
        for layer in self.body:
            output = layer(output)
        return self.upsampler(output) + F.interpolate(pixels, scale_factor=4, mode="nearest")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    with tempfile.TemporaryDirectory(prefix="cleanframe-weights-") as temporary:
        weights = []
        provenance = []
        for name in ["realesr-general-x4v3", "realesr-general-wdn-x4v3"]:
            path = Path(temporary) / (name + ".pth")
            url = UPSTREAM + path.name
            urllib.request.urlretrieve(url, path)
            weights.append(torch.load(path, map_location="cpu", weights_only=True)["params"])
            provenance.append({"url": url, "sha256": sha256(path)})
        # Official inference default: 50% denoising, preserving more natural texture.
        combined = {key: (weights[0][key] + weights[1][key]) * 0.5 for key in weights[0]}
        model = SRVGGNetCompact().eval()
        model.load_state_dict(combined, strict=True)
        target = DESTINATION / "realesr-general-x4v3-dn50.onnx"
        torch.onnx.export(
            model, torch.zeros(1, 3, 96, 96), str(target),
            input_names=["input"], output_names=["output"], opset_version=17,
            dynamic_axes={"input": {2: "height", 3: "width"}, "output": {2: "out_height", 3: "out_width"}},
            dynamo=False,
        )
        onnx.checker.check_model(str(target))
        sample = np.random.default_rng(42).random((1, 3, 79, 83), dtype=np.float32)
        with torch.no_grad():
            expected = model(torch.from_numpy(sample)).numpy()
        session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
        actual = session.run(None, {"input": sample})[0]
        np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-5)
        license_url = f"https://raw.githubusercontent.com/xinntao/Real-ESRGAN/{COMMIT}/LICENSE"
        urllib.request.urlretrieve(license_url, DESTINATION / "LICENSE.txt")
        (DESTINATION / "provenance.json").write_text(json.dumps({
            "algorithm": "Real-ESRGAN", "model": "realesr-general-x4v3", "denoiseStrength": 0.5,
            "upstreamCommit": COMMIT, "weights": provenance,
            "onnx": {"file": target.name, "sha256": sha256(target), "opset": 17},
            "verification": {"shape": list(actual.shape), "maxAbsoluteError": float(np.abs(actual - expected).max())},
        }, indent=2) + "\n", encoding="utf-8")
        print(f"Verified {target.name}: {target.stat().st_size} bytes; max error {np.abs(actual - expected).max():.8f}")


if __name__ == "__main__":
    main()
