export const CATEGORIES = ['documents', 'education', 'finance', 'career', 'images', 'archives', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Default destination folder per category. Trusted code, never the model, decides destinations. */
export const DEFAULT_CATEGORY_DIRS: Readonly<Record<Category, string>> = {
  documents: 'Documents',
  education: 'Education',
  finance: 'Finance',
  career: 'Career',
  images: 'Images',
  archives: 'Archives',
  other: 'Other'
};

export const DEFAULT_EXCLUDED_DIRS = ['node_modules', '.git', '.svn', '$RECYCLE.BIN', 'System Volume Information'] as const;

export const SUPPORTED_EXTRACT_EXTENSIONS = ['.txt', '.md', '.pdf'] as const;

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export const APP_NAME = 'SlothFile';
export const TAGLINE = 'Your files organized. Your effort minimized.';
export const SUPPORTING_MESSAGE = 'Let AI make the plan. You approve every move.';

/** Marker used for temporary files created during cross-device copies. */
export const TEMP_PREFIX = '.slothfile-partial-';
