from __future__ import annotations

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from mobile_flow import parse_args as parse_mobile_flow_args
from mobile_visual_flow import parse_args as parse_mobile_visual_args


class MobileScriptArgumentTests(unittest.TestCase):
    def test_mobile_flow_parses_explicit_viewport_and_base_url(self) -> None:
        arguments = parse_mobile_flow_args(
            ["--base-url", "http://127.0.0.1:4174", "--width", "412", "--height", "915"]
        )

        self.assertEqual(arguments.base_url, "http://127.0.0.1:4174")
        self.assertEqual(arguments.width, 412)
        self.assertEqual(arguments.height, 915)

    def test_mobile_visual_flow_parses_explicit_viewport_and_base_url(self) -> None:
        arguments = parse_mobile_visual_args(
            ["--base-url", "http://127.0.0.1:4174", "--width", "360", "--height", "800"]
        )

        self.assertEqual(arguments.base_url, "http://127.0.0.1:4174")
        self.assertEqual(arguments.width, 360)
        self.assertEqual(arguments.height, 800)


if __name__ == "__main__":
    unittest.main()
