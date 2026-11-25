import { UserSettings } from './types';

export const DEFAULT_SETTINGS: UserSettings = {
  subfolder: 'SocialDownloads',
  nativeFolder: null,
  filenameTemplate: '[{platform}] {author} - {id}_{index}',
  autoDownloadAllCarousel: true,
};

/**
 * Chrome native-messaging application name. Must match the `name` field of the
 * host manifest installed to
 * `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.
 */
export const NATIVE_HOST_NAME = 'com.omni.media.downloader';

export const STORAGE_KEYS = {
  SETTINGS: 'soc_settings',
  HISTORY: 'soc_history',
} as const;

export const INTERCEPTOR_EVENT_NAME = '__SOC_MEDIA_INTERCEPTED__';
export const CURRENT_PAGE_EVENT_NAME = '__SOC_GET_CURRENT_MEDIA__';

export const PLATFORM_SELECTORS = {
  TWITTER: {
    TWEET: 'article[data-testid="tweet"]',
    ACTION_GROUP: 'div[role="group"]',
    PHOTO: '[data-testid="tweetPhoto"]',
    VIDEO: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
  },
  INSTAGRAM: {
    ARTICLE: 'article',
    FEED_POST: 'article[role="presentation"], div[role="dialog"] article',
    REELS: 'div[role="dialog"], div[data-reels="true"]',
    ACTION_BAR: 'section',
  },
  REDDIT: {
    POST: 'shreddit-post',
    ACTION_ROW: 'div[slot="action-row"], [slot="flatlist"]',
    LEGACY_POST: 'div.Post, div.thing',
  },
} as const;
