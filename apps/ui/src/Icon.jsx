const ICON_PATHS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5l3 5" /></>,
  attach: <path d="m21.4 11.1-9.2 9.4a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  close: <path d="m18 6-12 12M6 6l12 12" />,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  archive: <><path d="M3 4h18v4H3z" /><path d="M5 8v12h14V8M10 12h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  edit: <><path d="m15 5 4 4" /><path d="M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4Z" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  cancel: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
};

export default function Icon({ name, className = '' }) {
  return (
    <svg className={`ui-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}
