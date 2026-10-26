import type { SVGProps } from 'react';

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  idea: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3z" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-8 8" />
    </>
  ),
  extension: <path d="M5 4v7a4 4 0 0 0 4 4h10M15 11l4 4-4 4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  book: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6M9 10.5h4" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
