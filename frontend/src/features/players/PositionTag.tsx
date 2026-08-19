export function PositionTag({ position }: { position: string | null }) {
  if (!position) return null

  return (
    <span className="position-tag" data-position={position}>
      {position}
    </span>
  )
}
