import runpy
import sys
import types
import unittest
from unittest.mock import patch


class _StopServer(Exception):
    """Raised by mocked socket runner to stop startup path."""


def _install_optional_dependency_stubs() -> None:
    numpy_mod = types.ModuleType("numpy")
    numpy_mod.uint8 = int
    numpy_mod.frombuffer = lambda *args, **kwargs: None
    numpy_mod.sqrt = lambda value: value ** 0.5
    sys.modules["numpy"] = numpy_mod

    cv2 = types.SimpleNamespace(
        IMREAD_COLOR=1,
        COLOR_BGR2RGB=1,
        imdecode=lambda *args, **kwargs: None,
        cvtColor=lambda *args, **kwargs: None,
    )
    sys.modules["cv2"] = cv2

    pil_mod = types.ModuleType("PIL")
    pil_mod.Image = object
    sys.modules["PIL"] = pil_mod

    mp = types.ModuleType("mediapipe")
    mp.Image = lambda *args, **kwargs: None
    mp.ImageFormat = types.SimpleNamespace(SRGB=0)

    tasks_mod = types.ModuleType("mediapipe.tasks")
    python_mod = types.ModuleType("mediapipe.tasks.python")
    vision_mod = types.ModuleType("mediapipe.tasks.python.vision")

    class _Delegate:
        GPU = "GPU"
        CPU = "CPU"

    class BaseOptions:
        Delegate = _Delegate

        def __init__(self, *args, **kwargs):
            pass

    class RunningMode:
        VIDEO = "VIDEO"

    class HandLandmarkerOptions:
        def __init__(self, *args, **kwargs):
            pass

    class HandLandmarker:
        @staticmethod
        def create_from_options(_opts):
            return object()

    python_mod.BaseOptions = BaseOptions
    python_mod.vision = vision_mod
    vision_mod.RunningMode = RunningMode
    vision_mod.HandLandmarkerOptions = HandLandmarkerOptions
    vision_mod.HandLandmarker = HandLandmarker

    tasks_mod.python = python_mod
    mp.tasks = tasks_mod

    sys.modules["mediapipe"] = mp
    sys.modules["mediapipe.tasks"] = tasks_mod
    sys.modules["mediapipe.tasks.python"] = python_mod
    sys.modules["mediapipe.tasks.python.vision"] = vision_mod


class StartupResilienceTests(unittest.TestCase):
    def test_startup_survives_model_download_and_detector_init_failure(self):
        _install_optional_dependency_stubs()
        with patch(
            "urllib.request.urlretrieve",
            side_effect=RuntimeError("simulated download failure"),
        ), patch(
            "mediapipe.tasks.python.vision.HandLandmarker.create_from_options",
            side_effect=OSError("simulated detector init failure"),
        ), patch(
            "flask_socketio.SocketIO.run",
            side_effect=_StopServer(),
        ):
            with self.assertRaises(_StopServer):
                runpy.run_path("server/server.py", run_name="__main__")


if __name__ == "__main__":
    unittest.main()
