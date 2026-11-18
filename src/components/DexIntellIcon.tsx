import type { SVGProps } from 'react'

export default function DexIntellIcon({ size = 17, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <circle cx="10.5" cy="10.5" r="6.1" strokeWidth="1" opacity=".55" />
    <path d="m10.5 4.9-2.9 5.3 2.9 1.7 2.9-1.7-2.9-5.3Z" fill="currentColor" fillOpacity=".12" strokeWidth="1" />
    <path d="m7.6 11.6 2.9 3.7 2.9-3.7-2.9 1.7-2.9-1.7Z" fill="currentColor" fillOpacity=".2" strokeWidth=".9" />
    <circle cx="10.5" cy="10.5" r="8.3" strokeWidth="1.7" />
    <path d="m16.5 16.5 5.3 5.3" strokeWidth="2.4" />
  </svg>
}
