export function ChannelMark({ logo, color }: { logo: string; color: string }) {
  return (
    <span className="mark" style={{ background: color }} aria-hidden="true">
      {logo}
    </span>
  )
}
