"""Test configuration for the studio backend scaffold.

Adds the worktree root (three levels up: studio/backend/conftest.py ->
studio/backend -> studio -> <worktree root>) to sys.path so tests can do
``import studio.backend.models`` etc. regardless of the current working
directory the test runner was invoked from. This file, plus
``studio/backend/pytest.ini``, makes ``python -m pytest studio/backend -q``
self-contained and independent of the repo-root ``tests/conftest.py``.
"""

import sys
from pathlib import Path

_WORKTREE_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_WORKTREE_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKTREE_ROOT))
