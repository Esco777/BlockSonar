import type { TokenMark } from '../lib/swap-presentation'

export default function TokenLogo({ mark }: { mark: TokenMark }) {
  return <svg viewBox="0 0 64 64" aria-hidden="true" className={`holo-token-logo logo-${mark}`}>
    {mark === 'ethereum' ? <><path d="M32 4 14 32l18 11 18-11L32 4Z" fill="currentColor" opacity=".9" /><path d="m14 36 18 24 18-24-18 11-18-11Z" fill="currentColor" /><path d="m32 4 18 28-18-8V4Zm0 20v19L14 32l18-8Z" fill="#fff" opacity=".22" /></>
      : mark === 'usdc' ? <><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M42 22c-2-4-6-6-11-6-6 0-10 3-10 8 0 11 22 5 22 16 0 5-5 8-11 8-5 0-9-2-12-6M32 11v8m0 27v7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /><path d="M12 20a24 24 0 0 0 0 24m40-24a24 24 0 0 1 0 24" fill="none" stroke="currentColor" strokeWidth="3" /></>
      : mark === 'tether' ? <><path d="M10 10h44v10H37v7H27v-7H10V10Z" fill="currentColor" /><ellipse cx="32" cy="30" rx="25" ry="7" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M27 28h10v28H27z" fill="currentColor" /></>
      : mark === 'solana' ? <><path d="m13 10 43 0-9 10H4l9-10Zm-9 17h43l9 10H13L4 27Zm9 17h43l-9 10H4l9-10Z" fill="currentColor" /></>
      : mark === 'bnb' ? <><path d="m32 5 11 11-6 6-5-5-5 5-6-6L32 5Zm0 54L21 48l6-6 5 5 5-5 6 6-11 11ZM5 32l11-11 6 6-5 5 5 5-6 6L5 32Zm54 0L48 43l-6-6 5-5-5-5 6-6 11 11ZM32 23l9 9-9 9-9-9 9-9Z" fill="currentColor" /></>
      : <><circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m22 25 10-6 10 6v14l-10 6-10-6V25Zm0 0 10 7 10-7m-10 7v13" fill="none" stroke="currentColor" strokeWidth="2" /></>}
  </svg>
}
