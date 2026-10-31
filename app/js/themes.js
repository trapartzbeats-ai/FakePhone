// Chat app looks. A theme picks the bubble/header/composer style; the device picks the hardware,
// status bar, keyboard and font.
export const THEMES = {
  imessage: { label: 'iMessage', family: 'ios', placeholder: 'iMessage', receipts: true },
  sms: { label: 'Text (green)', family: 'ios', placeholder: 'Text Message', receipts: true },
  android: { label: 'Android Messages', family: 'android', placeholder: 'RCS message' },
  whatsapp: { label: 'WhatsApp', family: 'whatsapp', placeholder: 'Message', ticks: true },
  instagram: { label: 'Instagram DM', family: 'instagram', placeholder: 'Message...' },
};

export const DEVICES = {
  island: { label: 'iPhone · Dynamic Island', os: 'ios', safeTop: 59, safeBottom: 34, radius: 55 },
  notch: { label: 'iPhone · Notch', os: 'ios', safeTop: 47, safeBottom: 34, radius: 47 },
  android: { label: 'Android · Punch hole', os: 'android', safeTop: 38, safeBottom: 22, radius: 34 },
};

const IOS_FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
const ANDROID_FONT = '"Roboto", "Segoe UI", system-ui, sans-serif';
const EMOJI = { noto: '"Noto Color Emoji", "Segoe UI Emoji"', system: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"' };

let fontStack = IOS_FONT;
let emojiStack = EMOJI.noto;
export function setFonts(project) {
  fontStack = DEVICES[project.device]?.os === 'android' ? ANDROID_FONT : IOS_FONT;
  emojiStack = EMOJI[project.emojiStyle] || EMOJI.noto;
}
export const font = (size, weight = 400) => `${weight} ${size}px ${fontStack}, ${emojiStack}`;
export const emojiFont = (size) => `${size}px ${emojiStack}`;

export function palette(p) {
  const dark = !!p.dark;
  const fam = THEMES[p.theme]?.family || 'ios';
  const androidOS = DEVICES[p.device]?.os === 'android';
  let c;
  if (fam === 'ios') {
    c = dark
      ? { bg: '#000000', text: '#FFFFFF', sub: '#8E8E93', me: '#0A84FF', meText: '#FFFFFF', them: '#262629', themText: '#FFFFFF',
        link: '#0A84FF', header: 'rgba(24,24,26,0.8)', headerText: '#FFFFFF', accent: '#0A84FF', sep: 'rgba(84,84,88,0.55)',
        inputBg: '#000000', inputBorder: '#3A3A3C', placeholder: '#5C5C60', bar: '#000000', icon: '#8E8E93' }
      : { bg: '#FFFFFF', text: '#000000', sub: '#8A8A8E', me: '#0B84FE', meText: '#FFFFFF', them: '#E9E9EB', themText: '#000000',
        link: '#0A7AFF', header: 'rgba(246,246,246,0.8)', headerText: '#000000', accent: '#007AFF', sep: 'rgba(60,60,67,0.2)',
        inputBg: '#FFFFFF', inputBorder: '#C9C9CE', placeholder: '#BDBDC2', bar: '#FFFFFF', icon: '#8A8A8E' };
    if (p.theme === 'sms') c.me = dark ? '#30D158' : '#34C759';
  } else if (fam === 'android') {
    c = dark
      ? { bg: '#131314', text: '#E3E3E3', sub: '#9AA0A6', me: '#0B57D0', meText: '#FFFFFF', them: '#2A2C2F', themText: '#E3E3E3',
        link: '#A8C7FA', header: '#131314', headerText: '#E3E3E3', accent: '#A8C7FA', sep: '#2A2C2F',
        inputBg: '#2A2C2F', inputBorder: '#2A2C2F', placeholder: '#9AA0A6', bar: '#131314', icon: '#C4C7C5' }
      : { bg: '#FFFFFF', text: '#1F1F1F', sub: '#5F6368', me: '#0B57D0', meText: '#FFFFFF', them: '#E9EEF6', themText: '#1F1F1F',
        link: '#0B57D0', header: '#FFFFFF', headerText: '#1F1F1F', accent: '#0B57D0', sep: '#E3E3E3',
        inputBg: '#E9EEF6', inputBorder: '#E9EEF6', placeholder: '#5F6368', bar: '#FFFFFF', icon: '#444746' };
  } else if (fam === 'whatsapp') {
    c = dark
      ? { bg: '#0B141A', text: '#E9EDEF', sub: '#8696A0', me: '#005C4B', meText: '#E9EDEF', them: '#202C33', themText: '#E9EDEF',
        link: '#53BDEB', header: '#1F2C34', headerText: '#E9EDEF', accent: '#00A884', sep: '#222D34',
        inputBg: '#2A3942', inputBorder: '#2A3942', placeholder: '#8696A0', bar: '#1F2C34', icon: '#8696A0', tick: '#53BDEB', doodle: 'rgba(255,255,255,0.035)' }
      : { bg: '#EFEAE2', text: '#111B21', sub: '#667781', me: '#D9FDD3', meText: '#111B21', them: '#FFFFFF', themText: '#111B21',
        link: '#027EB5', header: androidOS ? '#008069' : '#F6F5F3', headerText: androidOS ? '#FFFFFF' : '#111B21', accent: '#00A884', sep: '#D1D7DB',
        inputBg: '#FFFFFF', inputBorder: '#FFFFFF', placeholder: '#8696A0', bar: androidOS ? 'transparent' : '#F6F5F3', icon: androidOS ? '#FFFFFF' : '#007AFF', tick: '#53BDEB', doodle: 'rgba(80,60,30,0.06)' };
    if (dark && !androidOS) c.icon = '#00A884';
  } else {
    c = dark
      ? { bg: '#000000', text: '#FFFFFF', sub: '#A8A8A8', me: '#7B3CF7', meText: '#FFFFFF', them: '#262626', themText: '#FFFFFF',
        link: '#E0F1FF', header: '#000000', headerText: '#FFFFFF', accent: '#3797F0', sep: '#262626',
        inputBg: '#262626', inputBorder: '#262626', placeholder: '#A8A8A8', bar: '#000000', icon: '#FFFFFF' }
      : { bg: '#FFFFFF', text: '#000000', sub: '#737373', me: '#7B3CF7', meText: '#FFFFFF', them: '#EFEFEF', themText: '#000000',
        link: '#00376B', header: '#FFFFFF', headerText: '#000000', accent: '#3797F0', sep: '#DBDBDB',
        inputBg: '#EFEFEF', inputBorder: '#EFEFEF', placeholder: '#737373', bar: '#FFFFFF', icon: '#000000' };
    c.meGrad = ['#A63BF2', '#7B3CF7', '#3A86F7'];
  }
  c.family = fam;
  c.dark = dark;
  c.os = DEVICES[p.device]?.os || 'ios';
  c.kb = c.os === 'android'
    ? (dark ? { bg: '#1E1F20', key: '#38393C', special: '#2B2C2E', label: '#E3E3E3', accent: '#A8C7FA', accentLabel: '#062E6F' }
      : { bg: '#E9EEF6', key: '#FFFFFF', special: '#D3DBE5', label: '#1F1F1F', accent: '#0B57D0', accentLabel: '#FFFFFF' })
    : (dark ? { bg: '#2C2C2E', key: '#6B6B6F', special: '#46464A', label: '#FFFFFF', shadow: 'rgba(0,0,0,0.5)', pop: '#6B6B6F' }
      : { bg: '#D1D4DA', key: '#FFFFFF', special: '#ABB0BA', label: '#000000', shadow: 'rgba(0,0,0,0.32)', pop: '#FFFFFF' });
  return c;
}

// Which system sound each app plays.
export function soundSet(theme) {
  switch (theme) {
    case 'whatsapp': return { send: 'waSend', receive: 'waReceive', notify: 'waNotify' };
    case 'android': return { send: 'aSend', receive: 'aReceive', notify: 'aNotify' };
    case 'instagram': return { send: 'igSend', receive: 'igReceive', notify: 'igNotify' };
    default: return { send: 'send', receive: 'receive', notify: 'notify' };
  }
}
