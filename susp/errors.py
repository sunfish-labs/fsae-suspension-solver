"""Errors raised by the solver library. The command line (susp_solver.py) catches SuspError once and prints its
message; library users and tests can catch the specific type."""


class SuspError(Exception):
    """Base class for every error the solver raises on purpose."""


class ConfigError(SuspError, ValueError):
    """A design, car or targets file is missing something or has the wrong shape."""


class UnknownPointError(ConfigError, KeyError):
    """A hardpoint or spring point name that the solver doesn't know (optimize --vary, import)."""

    def __str__(self):                  # KeyError would quote the message
        return str(self.args[0]) if self.args else ""


class GoalError(SuspError, ValueError):
    """A bad optimizer goal, sensitivity metric or command-line option value."""


class SolveError(SuspError, RuntimeError):
    """The links can't reach a position (or the statics are singular)."""
