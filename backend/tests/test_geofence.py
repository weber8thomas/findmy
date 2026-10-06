import pytest

from app.services.geofence import Circle, GeoState, classify, haversine_m, step

ZONE = Circle(48.8584, 2.2945, 200)  # 200 m around the Eiffel Tower
INSIDE = (48.8584, 2.2945)
FAR = (48.8700, 2.2945)  # ~1.3 km north
EDGE = (48.8584 + 210 / 111_195, 2.2945)  # ~210 m north: inside the hysteresis band


def test_haversine():
    assert haversine_m(0, 0, 0, 1) == pytest.approx(111_195, rel=1e-3)
    assert haversine_m(*INSIDE, *INSIDE) == 0


@pytest.mark.parametrize(
    "point,acc,expected",
    [
        (INSIDE, 10, "inside"),
        (FAR, 10, "outside"),
        (EDGE, 10, None),  # 210 m < 200 + margin(25)
        (INSIDE, 1000, "inside"),  # accuracy capped at the radius
    ],
)
def test_classify(point, acc, expected):
    assert classify(ZONE, *point, acc) == expected


def run(states_points, **kw):
    st = GeoState()
    events = []
    for lat, lon, acc in states_points:
        st, ev = step(st, ZONE, lat, lon, acc, **kw)
        events.append(ev)
    return st, events


def test_first_fix_sets_baseline_silently():
    st, events = run([(*INSIDE, 10)])
    assert st.state == "inside" and events == [None]


def test_exit_needs_two_fixes():
    st, events = run([(*INSIDE, 10), (*FAR, 10), (*FAR, 10)])
    assert events == [None, None, "exit"]
    assert st.state == "outside"


def test_single_outlier_does_not_trigger():
    st, events = run([(*INSIDE, 10), (*FAR, 10), (*INSIDE, 10), (*FAR, 10)])
    assert events == [None, None, None, None]
    assert st.state == "inside"


def test_ambiguous_band_resets_pending():
    _, events = run([(*INSIDE, 10), (*FAR, 10), (*EDGE, 10), (*FAR, 10)])
    assert events == [None, None, None, None]


def test_enter_after_exit():
    _, events = run([(*FAR, 10), (*INSIDE, 10), (*INSIDE, 10)])
    assert events == [None, None, "enter"]


def test_inaccurate_fix_ignored():
    st, events = run([(*INSIDE, 10), (*FAR, 900), (*FAR, 900)])
    assert events == [None, None, None]
    assert st.state == "inside"


def test_sparse_provider_confirms_on_one_fix():
    _, events = run([(*INSIDE, 10), (*FAR, 10)], sparse=True)
    assert events == [None, "exit"]


def test_confirm_one():
    _, events = run([(*INSIDE, 10), (*FAR, 10)], confirm_fixes=1)
    assert events == [None, "exit"]
