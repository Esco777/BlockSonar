export default function PrivateSaveStatus({
  sync,
}: {
  sync: { ready: boolean; error: string; unsaved: boolean; retry: () => void; reload: () => void }
}) {
  if (sync.ready && !sync.error && !sync.unsaved) return null
  return (
    <div className='dex-notice' role='status'>
      <span>
        {sync.error ||
          (sync.ready
            ? 'Saving your private lists… Keep this page open until saving finishes.'
            : 'Loading your private lists…')}
      </span>
      {sync.error && (
        <>
          <button type='button' className='refresh-button' onClick={sync.retry}>
            Retry
          </button>
          <button type='button' className='refresh-button' onClick={sync.reload}>
            Reload saved lists (discard unsaved edits)
          </button>
        </>
      )}
    </div>
  )
}
