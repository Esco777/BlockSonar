import 'dotenv/config'
import { Backups } from '../server/dist/server/backups.js'
const backups = new Backups()
try {
  const [action, folder] = process.argv.slice(2)
  if (action === 'verify' && folder) console.log(JSON.stringify(await backups.verify(folder), null, 2))
  else if (action === 'create' || !action) console.log(`Backup saved: ${await backups.run()}`)
  else throw new Error('Use create, or verify <backup-directory>. Verification restores into a new temporary database only.')
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await backups.stop() }
