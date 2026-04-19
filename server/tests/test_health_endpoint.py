import importlib.util
import sys
import types
import unittest


def _install_optional_dependency_stubs() -> None:
    """Install lightweight stubs so server.py can be imported in CI."""
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


def _load_server_module():
    _install_optional_dependency_stubs()
    spec = importlib.util.spec_from_file_location("server_module", "server/server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HealthEndpointTests(unittest.TestCase):
    def test_health_is_unhealthy_when_detector_uninitialized(self):
        module = _load_server_module()
        module.gesture_detector = None

        client = module.app.test_client()
        response = client.get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"status": "unhealthy", "gesture_detector_initialized": False},
        )


if __name__ == "__main__":
    unittest.main()
