// Names and order of the app icons (the drawing is in render/appicons.js).
export const APP_NAMES = {
  imessage: 'Messages', android: 'Messages', whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', messenger: 'Messenger',
  snapchat: 'Snapchat', tiktok: 'TikTok', x: 'X', telegram: 'Telegram', discord: 'Discord', slack: 'Slack', gmail: 'Gmail', mail: 'Mail',
  phone: 'Phone', youtube: 'YouTube', spotify: 'Spotify', netflix: 'Netflix', music: 'Music', uber: 'Uber', cashapp: 'Cash App', venmo: 'Venmo',
  safari: 'Safari', photos: 'Photos', camera: 'Camera', calendar: 'Calendar', clock: 'Clock', maps: 'Maps', weather: 'Weather', notes: 'Notes',
  settings: 'Settings', appstore: 'App Store',
};
// the order in the pickers: the chat apps first, then everything else
export const APP_ORDER = Object.keys(APP_NAMES);

// The chat app the project's look stands for.
export const themeApp = (theme) => ({ imessage: 'imessage', sms: 'imessage', android: 'android', whatsapp: 'whatsapp', instagram: 'instagram' })[theme] || 'imessage';

export const APP_CHOICES = [['auto', 'Same as the chat app'], ...APP_ORDER.map((id) => [id, APP_NAMES[id]]), ['custom', 'Custom app (your own icon)…']];
