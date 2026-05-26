import importlib.util
import sys
import types
import unittest


def _install_optional_dependency_stubs() -> None:
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


class SocketPayloadValidationTests(unittest.TestCase):
    def test_validate_socket_payload_rejects_non_object(self):
        module = _load_server_module()
        with self.assertRaises(ValueError):
            module._validate_socket_payload("not-a-dict")

    def test_normalize_room_name_rejects_illegal_chars(self):
        module = _load_server_module()
        with self.assertRaises(ValueError):
            module._normalize_room_name("room/../../tmp")

    def test_normalize_room_name_defaults_empty_to_default(self):
        module = _load_server_module()
        self.assertEqual(module._normalize_room_name("   "), "default")


if __name__ == "__main__":
    unittest.main()
