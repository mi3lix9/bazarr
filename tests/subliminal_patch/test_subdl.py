import os

import pytest
from subzero.language import Language
from subliminal_patch.providers.subdl import SubdlProvider
from subliminal_patch.providers.subdl import SubdlSubtitle


@pytest.fixture(scope="session")
def provider():
    with SubdlProvider(os.environ["SUBDL_TOKEN"]) as provider:
        yield provider


def test_list_subtitles_movie(provider, movies, languages):
    for sub in provider.list_subtitles(movies["dune"], {languages["en"]}):
        assert sub.language == languages["en"]


def test_download_subtitle(provider, languages):
    data = {
        "language": languages["en"],
        "forced": False,
        "hearing_impaired": False,
        "page_link": "https://subdl.com/s/info/ebC6BrLCOC",
        "download_link": "/subtitle/2808552-2770424.zip",
        "file_id": "SUBDL::dune-2021-2770424.zip",
        "release_names": ["Dune Part 1 WebDl"],
        "uploader": "makoto77",
        "season": 0,
        "episode": None,
    }

    sub = SubdlSubtitle(**data)
    provider.download_subtitle(sub)

    assert sub.is_valid()


def test_get_matches_episode_standard_numbering(episodes):
    video = episodes["got_s03e10"]
    subtitle = SubdlSubtitle(
        language=Language("ara"),
        forced=False,
        hearing_impaired=False,
        page_link="https://subdl.com/s/info/test",
        download_link="/subtitle/test.zip",
        file_id="SUBDL::test-episode-standard",
        release_names=["Game of Thrones - S03E10"],
        uploader="tester",
        season=3,
        episode=10,
    )

    matches = subtitle.get_matches(video)

    assert {"series", "season", "episode"}.issubset(matches)


def test_get_matches_episode_absolute_numbering(episodes):
    video = episodes["got_s03e10"]
    video.absolute_episode = 999
    subtitle = SubdlSubtitle(
        language=Language("ara"),
        forced=False,
        hearing_impaired=False,
        page_link="https://subdl.com/s/info/test",
        download_link="/subtitle/test.zip",
        file_id="SUBDL::test-episode-absolute",
        release_names=["Game of Thrones - 999"],
        uploader="tester",
        season=3,
        episode=999,
    )

    matches = subtitle.get_matches(video)

    assert {"series", "season", "episode"}.issubset(matches)


def test_get_matches_episode_absolute_numbering_with_ambiguous_release(episodes):
    video = episodes["got_s03e10"]
    video.absolute_episode = 1153
    subtitle = SubdlSubtitle(
        language=Language("ara"),
        forced=False,
        hearing_impaired=False,
        page_link="https://subdl.com/s/info/test",
        download_link="/subtitle/test.zip",
        file_id="SUBDL::test-episode-absolute-ambiguous",
        release_names=["One Piece - 1153"],
        uploader="tester",
        season=3,
        episode=None,
    )

    matches = subtitle.get_matches(video)

    assert {"series", "season", "episode"}.issubset(matches)


def test_get_matches_episode_with_string_season_and_episode(episodes):
    video = episodes["got_s03e10"]
    subtitle = SubdlSubtitle(
        language=Language("ara"),
        forced=False,
        hearing_impaired=False,
        page_link="https://subdl.com/s/info/test",
        download_link="/subtitle/test.zip",
        file_id="SUBDL::test-episode-string-values",
        release_names=["Game of Thrones - S03E10"],
        uploader="tester",
        season="3",
        episode="10",
    )

    matches = subtitle.get_matches(video)

    assert {"series", "season", "episode"}.issubset(matches)
