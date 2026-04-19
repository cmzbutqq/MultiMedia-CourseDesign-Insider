import runpy
import unittest
from unittest.mock import patch


class _StopServer(Exception):
    """Raised by mocked socket runner to stop startup path."""


class StartupResilienceTests(unittest.TestCase):
    def test_startup_survives_model_download_and_detector_init_failure(self):
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
