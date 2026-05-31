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

    class _ImageModule:
        @staticmethod
        def open(_stream):
            class _Image:
                size = (320, 240)

                def __enter__(self):
                    return self

                def __exit__(self, *_args):
                    return False

            return _Image()

    pil_mod = types.ModuleType("PIL")
    pil_mod.Image = _ImageModule
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
    def test_health_is_degraded_when_detector_uninitialized(self):
        module = _load_server_module()
        module.gesture_detector = None

        client = module.app.test_client()
        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"status": "degraded", "gesture_detector_initialized": False},
        )

    def test_detect_returns_400_for_invalid_json_payload(self):
        module = _load_server_module()
        module.gesture_detector = None

        client = module.app.test_client()
        response = client.post(
            "/api/detect",
            data="{bad-json",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_dimension_guard_rejects_decompression_bomb(self):
        module = _load_server_module()

        class OversizedImageModule:
            @staticmethod
            def open(_stream):
                class _Image:
                    size = (module.MAX_IMAGE_PIXELS + 1, 1)

                    def __enter__(self):
                        return self

                    def __exit__(self, *_args):
                        return False

                return _Image()

        module.Image = OversizedImageModule

        with self.assertRaisesRegex(ValueError, "图片尺寸过大"):
            module._validate_image_dimensions(b"not-a-real-image")

    def test_detect_rate_limits_burst_requests(self):
        module = _load_server_module()
        module.gesture_detector = types.SimpleNamespace(initialized=True)
        module.rate_limits.clear()

        client = module.app.test_client()
        response = None
        for _ in range(module.MAX_FRAMES_PER_CLIENT_PER_SECOND + 1):
            response = client.post(
                "/api/detect",
                json={"image": "invalid"},
                headers={"X-Forwarded-For": "203.0.113.10"},
            )

        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, 429)


if __name__ == "__main__":
    unittest.main()
