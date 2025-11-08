# -*- coding: utf-8 -*-
import logging
import os
import time
import io
import re

from zipfile import ZipFile, is_zipfile
from urllib.parse import urljoin
from requests import Session

from babelfish import language_converters
from subzero.language import Language
from subliminal import Episode, Movie
from subliminal.exceptions import ConfigurationError, ProviderError, DownloadLimitExceeded
from subliminal_patch.exceptions import APIThrottled
from .mixins import ProviderRetryMixin
from subliminal_patch.subtitle import Subtitle
from subliminal.subtitle import fix_line_ending
from subliminal_patch.providers import Provider
from subliminal_patch.providers import utils

logger = logging.getLogger(__name__)

retry_amount = 3
retry_timeout = 5

language_converters.register('subdl = subliminal_patch.converters.subdl:SubdlConverter')

# Cache for absolute episode numbers from Sonarr API
_absolute_episode_cache = {}


def _get_absolute_episode_from_sonarr(sonarr_episode_id):
    """Fetch absolute episode number from Sonarr API using episode ID.
    
    Returns None if unable to fetch or if absoluteEpisodeNumber is not available.
    Uses caching to avoid repeated API calls.
    """
    if not sonarr_episode_id:
        return None
    
    # Check cache first
    if sonarr_episode_id in _absolute_episode_cache:
        return _absolute_episode_cache[sonarr_episode_id]
    
    try:
        # Try to import Sonarr utilities - only if available
        # Use try/except for import to handle cases where bazarr modules aren't available
        try:
            from bazarr.sonarr.sync.utils import get_episodes_from_sonarr_api
            from bazarr.app.config import settings
        except ImportError:
            logger.debug("Bazarr Sonarr utilities not available, skipping absolute episode lookup")
            return None
        
        if not settings.general.use_sonarr or not settings.sonarr.apikey:
            return None
        
        episode_data = get_episodes_from_sonarr_api(
            apikey_sonarr=settings.sonarr.apikey,
            episode_id=sonarr_episode_id
        )
        
        if episode_data and isinstance(episode_data, dict):
            absolute_episode = episode_data.get('absoluteEpisodeNumber')
            if absolute_episode is not None:
                _absolute_episode_cache[sonarr_episode_id] = absolute_episode
                logger.debug(f"Fetched absolute episode number {absolute_episode} for Sonarr episode {sonarr_episode_id}")
                return absolute_episode
        
    except Exception as e:
        logger.debug(f"Error fetching absolute episode number from Sonarr: {e}")
    
    # Cache None to avoid repeated failed attempts
    _absolute_episode_cache[sonarr_episode_id] = None
    return None


def _extract_absolute_episode_from_release(release_name):
    """Extract absolute episode number from SubDL release name.
    
    SubDL release names often contain absolute episode numbers like:
    - "[Crunchyroll] One Piece - 1148"
    - "One Piece - 1144"
    - "Series Name - 123"
    
    Returns the absolute episode number if found, None otherwise.
    """
    if not release_name:
        return None
    
    # Pattern to match episode numbers after series name
    # Matches patterns like "Series Name - 1148" or "[Source] Series Name - 1148"
    # Look for a dash/hyphen followed by a 3+ digit number (typical for absolute numbering)
    patterns = [
        r'[-–]\s*(\d{3,})(?:\s|$|\[|\.)',  # Match " - 1148" format (most common)
        r'\b(\d{3,})\b',  # Fallback: match any 3+ digit number
    ]
    
    for pattern in patterns:
        match = re.search(pattern, release_name)
        if match:
            try:
                episode_num = int(match.group(1))
                # Reasonable range for absolute episode numbers (1-10000)
                # Most anime shows with absolute numbering are in this range
                if 1 <= episode_num <= 10000:
                    logger.debug(f"Extracted absolute episode number {episode_num} from release: {release_name}")
                    return episode_num
            except (ValueError, IndexError):
                continue
    
    return None


class SubdlSubtitle(Subtitle):
    provider_name = 'subdl'
    hash_verifiable = False
    hearing_impaired_verifiable = True

    def __init__(self, language, forced, hearing_impaired, page_link, download_link, file_id, release_names, uploader,
                 season=None, episode=None, absolute_episode=None):
        super().__init__(language)
        language = Language.rebuild(language, hi=hearing_impaired, forced=forced)

        self.season = season
        self.episode = episode
        self.absolute_episode = absolute_episode
        self.releases = release_names
        self.release_info = ', '.join(release_names)
        self.language = language
        self.forced = forced
        self.hearing_impaired = hearing_impaired
        self.file_id = file_id
        self.page_link = page_link
        self.download_link = download_link
        self.uploader = uploader
        self.matches = None

    @property
    def id(self):
        return self.file_id

    def get_matches(self, video):
        matches = set()

        # handle movies and series separately
        if isinstance(video, Episode):
            # series
            matches.add('series')
            # season
            if video.season == self.season:
                matches.add('season')
            # episode - check both relative and absolute episode numbers
            if video.episode == self.episode:
                matches.add('episode')
            
            # Check absolute episode number match as fallback
            if self.absolute_episode is not None:
                # Try to get absolute episode number from video's Sonarr episode ID
                video_absolute_episode = None
                if hasattr(video, 'sonarrEpisodeId') and video.sonarrEpisodeId:
                    video_absolute_episode = _get_absolute_episode_from_sonarr(video.sonarrEpisodeId)
                
                if video_absolute_episode is not None and video_absolute_episode == self.absolute_episode:
                    logger.debug(f"Matched absolute episode number {self.absolute_episode} for video {video.sonarrEpisodeId} "
                               f"(season {video.season}, episode {video.episode})")
                    matches.add('episode')
                    # Also add season match if we have absolute episode match (for shows like One Piece)
                    if 'season' not in matches and video.season:
                        logger.debug(f"Adding season match due to absolute episode match")
                        matches.add('season')
                elif video_absolute_episode is not None:
                    logger.debug(f"Absolute episode mismatch: subtitle has {self.absolute_episode}, "
                               f"video has {video_absolute_episode} (Sonarr episode {video.sonarrEpisodeId})")
            
            # imdb
            matches.add('series_imdb_id')
        else:
            # title
            matches.add('title')
            # imdb
            matches.add('imdb_id')

        utils.update_matches(matches, video, self.release_info)

        self.matches = matches

        return matches


class SubdlProvider(ProviderRetryMixin, Provider):
    """Subdl Provider"""
    server_hostname = 'api.subdl.com'

    languages = {Language(*lang) for lang in list(language_converters['subdl'].to_subdl.keys())}
    languages.update(set(Language.rebuild(lang, forced=True) for lang in languages))
    languages.update(set(Language.rebuild(l, hi=True) for l in languages))

    video_types = (Episode, Movie)

    def __init__(self, api_key=None):
        if not api_key:
            raise ConfigurationError('Api_key must be specified')

        self.session = Session()
        self.session.headers = {'User-Agent': os.environ.get("SZ_USER_AGENT", "Sub-Zero/2")}
        self.api_key = api_key
        self.video = None
        self._started = None

    def initialize(self):
        self._started = time.time()

    def terminate(self):
        self.session.close()

    def server_url(self):
        return f'https://{self.server_hostname}/api/v1/'

    def query(self, languages, video):
        self.video = video
        if isinstance(self.video, Episode):
            title = self.video.series
        else:
            title = self.video.title

        imdb_id = None
        if isinstance(self.video, Episode) and self.video.series_imdb_id:
            imdb_id = self.video.series_imdb_id
        elif isinstance(self.video, Movie) and self.video.imdb_id:
            imdb_id = self.video.imdb_id

        # be sure to remove duplicates using list(set())
        langs_list = sorted(list(set([language_converters['subdl'].convert(lang.alpha3, lang.country, lang.script) for
                                      lang in languages])))

        langs = ','.join(langs_list)
        logger.debug(f'Searching for those languages: {langs}')

        # query the server
        if isinstance(self.video, Episode):
            res = self.retry(
                lambda: self.session.get(self.server_url() + 'subtitles',
                                         params=(('api_key', self.api_key),
                                                 ('episode_number', self.video.episode),
                                                 ('film_name', title if not imdb_id else None),
                                                 ('imdb_id', imdb_id if imdb_id else None),
                                                 ('languages', langs),
                                                 ('season_number', self.video.season),
                                                 ('subs_per_page', 30),
                                                 ('type', 'tv'),
                                                 ('comment', 1),
                                                 ('releases', 1),
                                                 ('bazarr', 1)),  # this argument filter incompatible image based or
                                         # txt subtitles
                                         timeout=30),
                amount=retry_amount,
                retry_timeout=retry_timeout
            )
        else:
            res = self.retry(
                lambda: self.session.get(self.server_url() + 'subtitles',
                                         params=(('api_key', self.api_key),
                                                 ('film_name', title if not imdb_id else None),
                                                 ('imdb_id', imdb_id if imdb_id else None),
                                                 ('languages', langs),
                                                 ('subs_per_page', 30),
                                                 ('type', 'movie'),
                                                 ('comment', 1),
                                                 ('releases', 1),
                                                 ('bazarr', 1)),  # this argument filter incompatible image based or
                                         # txt subtitles
                                         timeout=30),
                amount=retry_amount,
                retry_timeout=retry_timeout
            )

        if res.status_code == 429:
            raise APIThrottled("Too many requests")
        elif res.status_code == 403:
            raise ConfigurationError("Invalid API key")
        elif res.status_code != 200:
            res.raise_for_status()

        subtitles = []

        result = res.json()

        if ('success' in result and not result['success']) or ('status' in result and not result['status']):
            logger.debug(result)
            return []

        logger.debug(f"Query returned {len(result['subtitles'])} subtitles")

        if len(result['subtitles']):
            for item in result['subtitles']:
                if (isinstance(self.video, Episode) and
                        item.get('episode_from', False) != item.get('episode_end', False)):
                    # ignore season packs
                    continue
                else:
                    # Extract absolute episode number from release names
                    absolute_episode = None
                    release_names = item.get('releases', [])
                    if release_names:
                        # Try to extract absolute episode from each release name
                        for release_name in release_names:
                            extracted = _extract_absolute_episode_from_release(release_name)
                            if extracted is not None:
                                absolute_episode = extracted
                                break
                    
                    subtitle = SubdlSubtitle(
                        language=Language.fromsubdl(item['language']),
                        forced=self._is_forced(item),
                        hearing_impaired=item.get('hi', False) or self._is_hi(item),
                        page_link=urljoin("https://subdl.com", item.get('subtitlePage', '')),
                        download_link=item['url'],
                        file_id=item['name'],
                        release_names=release_names,
                        uploader=item.get('author', ''),
                        season=item.get('season', None),
                        episode=item.get('episode', None),
                        absolute_episode=absolute_episode,
                    )
                    subtitle.get_matches(self.video)
                    if subtitle.language in languages:  # make sure only desired subtitles variants are returned
                        subtitles.append(subtitle)

        return subtitles

    @staticmethod
    def _is_hi(item):
        # Comments include specific mention of removed or non HI
        non_hi_tag = ['hi remove', 'non hi', 'nonhi', 'non-hi', 'non-sdh', 'non sdh', 'nonsdh', 'sdh remove']
        for tag in non_hi_tag:
            if tag in item.get('comment', '').lower():
                return False

        # Archive filename include _HI_
        if '_hi_' in item.get('name', '').lower():
            return True

        # Comments or release names include some specific strings
        hi_keys = [item.get('comment', '').lower(), [x.lower() for x in item.get('releases', [])]]
        hi_tag = ['_hi_', ' hi ', '.hi.', 'hi ', ' hi', 'sdh', '𝓢𝓓𝓗']
        for key in hi_keys:
            if any(x in key for x in hi_tag):
                return True

        # nothing match so we consider it as non-HI
        return False

    @staticmethod
    def _is_forced(item):
        # Comments include specific mention of forced subtitles
        forced_tags = ['forced', 'foreign']
        for tag in forced_tags:
            if tag in item.get('comment', '').lower():
                return True

        # nothing match so we consider it as normal subtitles
        return False

    def list_subtitles(self, video, languages):
        return self.query(languages, video)

    def download_subtitle(self, subtitle):
        logger.debug('Downloading subtitle %r', subtitle)
        download_link = urljoin("https://dl.subdl.com", subtitle.download_link)

        r = self.retry(
            lambda: self.session.get(download_link, timeout=30),
            amount=retry_amount,
            retry_timeout=retry_timeout
        )

        if r.status_code == 429 or (r.status_code == 500 and r.text == 'Download limit exceeded'):
            raise DownloadLimitExceeded("Daily download limit exceeded")
        elif r.status_code == 403:
            raise ConfigurationError("Invalid API key")
        elif r.status_code != 200:
            r.raise_for_status()

        if not r:
            logger.error(f'Could not download subtitle from {download_link}')
            subtitle.content = None
            return
        else:
            archive_stream = io.BytesIO(r.content)
            if is_zipfile(archive_stream):
                archive = ZipFile(archive_stream)
                for name in archive.namelist():
                    # TODO when possible, deal with season pack / multiple files archive
                    subtitle_content = archive.read(name)
                    subtitle.content = fix_line_ending(subtitle_content)
                    return
            else:
                logger.error(f'Could not unzip subtitle from {download_link}')
                subtitle.content = None
                return
