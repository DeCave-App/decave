# Source snapshot notes

This source snapshot contains no history from the private source checkout. It was assembled from selected working-tree files; the destination repository starts with its own fresh commit history. Files ignored by Git, local credentials and configuration, local data, screenshots awaiting privacy review, internal compliance working papers, the private audit report, and the nested comparison checkout are omitted.

Production Cloudflare resource identifiers and the deployed app host are replaced with example values in the exported `wrangler.jsonc`; remote email delivery is disabled. The exported mobile configuration likewise uses placeholder bundle, signing, API, and EAS project values. Replace these example values with resources you control before deploying or publishing a mobile build.

ClearVoice model-training sources, model weights, and the bundled legacy ONNX Runtime are omitted. The ClearVoice AI runtime and its runtime-wiring test are replaced with model-free versions. AI enhancement therefore reports that its models are unavailable; the voice engine continues through its existing non-AI fallback path.

The root LICENSE is the DeCave Source Review License v1.0. It permits private copies for evaluation builds, tests, and security review, including paid independent review, and permits publishing findings and brief source excerpts. Outside those permissions and any applicable GitHub platform permissions, it grants no rights for commercial use, redistribution, modified versions, or use in a product or service. Read LICENSE for the complete terms and limitations. This is not an open-source license. Third-party components and assets may have separate terms; review their notices before using them.
