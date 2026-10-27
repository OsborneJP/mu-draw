"""scripts/usage_report.py prints the weekly usage totals, one row a week."""

import usage_report as report
from usage import USAGE_FILE, Summary, UsageCounts, tool_names


def counted(tmp_path):
    path = tmp_path / USAGE_FILE
    counts = UsageCounts(path)
    known = tool_names()
    counts.add(
        [
            Summary("2026-W43", 3, True, True, ("get-name",)),
            Summary("2026-W43", 1, False, False, ()),
            Summary("2026-W44", 2, False, False, ("export", "get-name")),
        ],
        known,
    )
    counts.close()
    return path


def test_one_row_a_week_with_the_browser_totals_then_each_tool(tmp_path):
    text = report.table(report.read_totals(counted(tmp_path)), ["get-name", "export"])
    lines = text.splitlines()
    rows = [line.split() for line in lines[:3]]
    assert rows == [
        ["week", "browsers", "browser-days", "installed", "new", "get-name", "export"],
        ["2026-W43", "2", "4", "1", "1", "1", "0"],
        ["2026-W44", "1", "2", "0", "0", "1", "1"],
    ]
    assert lines[3:] == ["", report.NOTE]
    assert len({len(line) for line in lines[:3]}) == 1  # columns line up


def test_no_counts_yet(tmp_path):
    path = tmp_path / USAGE_FILE
    UsageCounts(path).close()
    assert report.table(report.read_totals(path), report.tools()).startswith("No counts yet.")


def test_the_command_reads_a_file_without_changing_it(tmp_path, capsys):
    path = counted(tmp_path)
    before = path.read_bytes()
    assert report.main(["--db", str(path)]) == 0
    assert "2026-W44" in capsys.readouterr().out
    assert path.read_bytes() == before
    assert report.main(["--db", str(tmp_path / "missing.sqlite")]) == 1


def test_it_lists_the_servers_tools_in_order_and_reads_the_servers_file():
    assert set(report.tools()) == tool_names()
    assert report.USAGE_FILE == USAGE_FILE
