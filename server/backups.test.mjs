import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,mkdir,readFile,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Backups } from './dist/server/backups.js'
test('failed or incomplete backups are never reported as successful; tampering fails before restore',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'blocksonar-backup-test-'))
 try{
  const service=new Backups({BLOCKSONAR_BACKUP_DIR:dir})
  await assert.rejects(service.run(),/DEX_DATABASE_URL/)
  assert.equal((await service.status()).lastBackupAt,null)
  assert.equal((await service.status()).lastAttemptFailed,true)
  const backup=path.join(dir,'backup-2026-11-16T00-00-00-000Z-aaaaaaaa')
  await mkdir(backup)
  await writeFile(path.join(backup,'database.dump'),'tampered')
  await writeFile(path.join(backup,'manifest.json'),JSON.stringify({version:1,createdAt:'2026-11-16T00:00:00Z',tables:{},files:[{name:'database.dump',sha256:'not-the-hash'}]}))
  await assert.rejects(service.verify(backup),/checksum mismatch/)
  const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));manifest.files[0].name='../private';await writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest))
  await assert.rejects(service.verify(backup),/Invalid backup manifest/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
