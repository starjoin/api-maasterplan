const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')

test('isolated imports, availability, fidelity, failures and persisted publication', { timeout: 120000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maasterplan-test-'))
  Object.assign(process.env, { DATABASE_URL: `file:${root}/gtfs.db`, DATABASE_URL_GTFS: `file:${root}/gtfs.db`, DATABASE_URL_NETEX: `file:${root}/netex.db`,
    RFU_API_TOKEN: 'fixture', NODE_ENV: 'test', AUTO_IMPORT_ON_START: 'false', SIRI_VM_ENABLED: 'false', TMP_DIR: `${root}/tmp`, IMPORT_HEAP_MB: '256' })
  const db = require('../dist/db.js')
  const { runImportInWorker, stopImportWorker } = require('../dist/import-runner.js')
  const { buildServer } = require('../dist/server.js')
  const { getDownloadProgress, isImportRunning } = require('../dist/import-state.js')
  for (const source of ['gtfs','netex']) await db.ensureSourceDatabase(source)
  await db.setActiveSource('gtfs')
  const app = await buildServer()
  let entered, unblock
  const enteredPromise = new Promise(resolve => entered = resolve)
  const barrier = new Promise(resolve => unblock = resolve)
  app.get('/test/snapshot', async () => {
    const before = await db.prisma.route.findFirst()
    entered()
    await barrier
    const after = await db.prisma.route.findFirst()
    return { before: before?.longName, after: after?.longName }
  })
  const fixture = path.join(root, 'feed')
  await fs.mkdir(fixture)
  async function gtfs(name) {
    const files = {
      'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\na,Test,https://example.org,Europe/Paris\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type,custom_field\ns,Station,45,4,0,extra\nn,Node,45,4,3,node-extra\n',
      'routes.txt': `route_id,agency_id,route_short_name,route_long_name,route_type\nr,a,01,${name},3\n`,
      'trips.txt': 'route_id,service_id,trip_id\nr,c,t\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,25:00:00,25:00:00,s,1\n',
      'calendar_dates.txt': 'service_id,date,exception_type\nc,20260907,1\n',
      'fare_products.txt': 'fare_product_id,fare_product_name,amount,currency\nf,Ticket,2.5,EUR\n',
      'readme.json': '{"extra":true}',
    }
    for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(fixture, file), content)
  }
  try {
    await gtfs('Old')
    await runImportInWorker('gtfs','manual',true,fixture)
    assert.equal((await db.prisma.route.findFirst()).longName,'Old')
    assert.equal(await db.prisma.stop.count({where:{isPoi:true}}),0)
    const jobCount = await db.prisma.importJob.count()
    await db.prisma.apiEndpoint.create({data:{path:'/kept',responseSchema:'{}'}})
    const snapshotPromise = app.inject('/test/snapshot')
    // Injection starts when awaited/then is attached.
    const snapshot = snapshotPromise.then(r=>r.json())
    await enteredPromise
    await gtfs('New')
    const importing = runImportInWorker('gtfs','manual',true,fixture)
    await assert.rejects(runImportInWorker('netex','manual',true,fixture), /déjà/)
    const latencies = []
    while (isImportRunning()) {
      const started = performance.now()
      const response = await app.inject('/health')
      latencies.push(performance.now()-started)
      assert.equal(response.statusCode,200)
      assert.ok(['Old','New'].includes((await db.prisma.route.findFirst()).longName))
      await new Promise(r=>setTimeout(r,20))
    }
    await importing
    unblock()
    assert.deepEqual(await snapshot, {before:'Old',after:'Old'})
    assert.equal((await db.prisma.route.findFirst()).longName,'New')
    assert.equal(await db.prisma.apiEndpoint.count(),1)
    assert.equal(await db.prisma.importJob.count(),jobCount+1)
    console.log('Health latency during import (fixture), max ms:', Math.round(Math.max(...latencies)))
    let comparison = (await app.inject('/admin/compare')).json()
    const gtfsData = comparison.sources.find(s=>s.source==='gtfs')
    assert.equal(gtfsData.files.length,8)
    assert.equal(gtfsData.kinds.find(k=>k.kind==='stops.txt').fields.custom_field,2)
    assert.equal(gtfsData.kinds.find(k=>k.kind==='fare_products.txt').count,1)
    const download = await app.inject('/admin/inventory/file?source=gtfs&name=stops.txt')
    assert.equal(download.body,await fs.readFile(path.join(fixture,'stops.txt'),'utf8'))
    const manifest = JSON.parse(await fs.readFile(`${root}/gtfs.db.active.json`,'utf8'))
    assert.ok(manifest.databaseUrl.includes('.versions'))
    await fs.writeFile(path.join(fixture,'stop_times.txt'),'trip_id,arrival_time\n"broken')
    await assert.rejects(runImportInWorker('gtfs','manual',true,fixture))
    assert.equal((await db.prisma.route.findFirst()).longName,'New')
    assert.equal((await db.prisma.importJob.findFirst({orderBy:{createdAt:'desc'}})).status,'FAILED')
    assert.equal(JSON.parse(await fs.readFile(`${root}/gtfs.db.active.json`,'utf8')).databaseUrl,manifest.databaseUrl)
    await gtfs('Interrupted')
    await fs.writeFile(path.join(fixture,'stop_times.txt'), 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' + Array.from({length:20000}, (_,i) => `t,25:00:00,25:00:00,s,${i+1}\n`).join(''))
    const interrupted = runImportInWorker('gtfs','manual',true,fixture)
    const rejection = assert.rejects(interrupted, /interrompu/)
    while (isImportRunning()) {
      const current = await db.prisma.importJob.findFirst({orderBy:{createdAt:'desc'}})
      const progress = getDownloadProgress()
      if (current?.status === 'IMPORTING' && progress.phase === 'importing' && progress.counters.stopTimes != null) {
        assert.ok(progress.percent >= 45 && progress.percent <= 82)
        assert.ok(progress.phasePercent >= 0 && progress.phasePercent <= 100)
        assert.equal(progress.phaseLabel, 'Import en base')
        assert.ok(progress.detail)
        assert.ok(progress.currentItem)
        assert.ok(progress.counters.stopTimes >= 0)
        assert.ok(progress.recentEvents.length > 0)
        const liveStatus = (await app.inject('/admin/import/status')).json()
        assert.equal(liveStatus.running, true)
        assert.equal(liveStatus.downloadProgress.phaseLabel, 'Import en base')
        assert.ok(liveStatus.downloadProgress.elapsedSeconds >= 0)
        assert.ok(Array.isArray(liveStatus.downloadProgress.recentEvents))
        stopImportWorker()
        break
      }
      await new Promise(r=>setTimeout(r,5))
    }
    await rejection
    assert.equal((await db.prisma.route.findFirst()).longName,'New')
    assert.equal((await db.prisma.importJob.findFirst({orderBy:{createdAt:'desc'}})).status,'FAILED')
    // A single namespaced file in a subdirectory, with POIs and extensions.
    const netex = path.join(root,'netex/nested')
    await fs.mkdir(netex,{recursive:true})
    const xml = `<n:PublicationDelivery xmlns:n="urn:netex"><n:CompositeFrame id="frame"><n:members>
      <n:Operator id="op"><n:Name>Network</n:Name></n:Operator>
      <n:StopPlace id="sp"><n:Name>Station</n:Name><n:quays><n:Quay id="q"><n:Name>Quay</n:Name><n:Centroid><n:Location><n:Latitude>45</n:Latitude><n:Longitude>4</n:Longitude></n:Location></n:Centroid></n:Quay></n:quays></n:StopPlace>
      <n:PointOfInterest id="poi"><n:Name>Bike parking</n:Name><n:Centroid><n:Location><n:Latitude>45</n:Latitude><n:Longitude>4</n:Longitude></n:Location></n:Centroid><n:custom><n:Capacity>50</n:Capacity></n:custom></n:PointOfInterest>
      <n:Line id="line"><n:Name>Line</n:Name><n:PublicCode>001</n:PublicCode><n:TransportMode>bus</n:TransportMode><n:OperatorRef ref="op"/></n:Line>
      <n:Route id="route"><n:LineRef ref="line"/><n:DirectionType>outbound</n:DirectionType></n:Route>
      <n:PassengerStopAssignment id="assign"><n:ScheduledStopPointRef ref="ssp"/><n:QuayRef ref="q"/></n:PassengerStopAssignment>
      <n:ServiceJourneyPattern id="pattern"><n:RouteRef ref="route"/><n:pointsInSequence><n:StopPointInJourneyPattern id="p1" order="1"><n:ScheduledStopPointRef ref="ssp"/></n:StopPointInJourneyPattern></n:pointsInSequence></n:ServiceJourneyPattern>
      <n:DayType id="day"><n:properties><n:PropertyOfDay><n:DaysOfWeek>Monday</n:DaysOfWeek></n:PropertyOfDay></n:properties></n:DayType>
      <n:DayTypeAssignment id="date"><n:DayTypeRef ref="day"/><n:Date>2026-09-07</n:Date></n:DayTypeAssignment>
      <n:ServiceJourney id="journey"><n:ServiceJourneyPatternRef ref="pattern"/><n:dayTypes><n:DayTypeRef ref="day"/></n:dayTypes><n:passingTimes><n:TimetabledPassingTime id="time"><n:StopPointInJourneyPatternRef ref="p1"/><n:DepartureTime>01:05:00</n:DepartureTime><n:DepartureDayOffset>1</n:DepartureDayOffset></n:TimetabledPassingTime></n:passingTimes></n:ServiceJourney>
      <n:Parking id="parking"><n:Name>Park</n:Name><n:Capacity>100</n:Capacity></n:Parking>
      </n:members></n:CompositeFrame></n:PublicationDelivery>`
    await fs.writeFile(path.join(netex,'all.xml'),xml)
    await runImportInWorker('netex','manual',true,path.dirname(netex))
    assert.equal(db.getActiveSource(),'gtfs')
    await db.withSourcePrisma('netex', async c=>{
      assert.equal(await c.stop.count({where:{isPoi:true}}),1)
      assert.equal((await c.route.findFirst()).shortName,'001')
      assert.equal((await c.stopTime.findFirst()).departureTime,'25:05:00')
      assert.equal((await c.calendarDate.findFirst()).date,'20260907')
      assert.equal(await c.calendar.count(),0)
      assert.equal(await c.sourceRecord.count({where:{kind:'Parking'}}),1)
    })
    await fs.writeFile(path.join(netex,'bad.xml'),'<broken>')
    await assert.rejects(runImportInWorker('netex','manual',true,path.dirname(netex)))
    assert.equal(await db.withSourcePrisma('netex', c=>c.trip.count()),1)
    comparison = (await app.inject('/admin/compare')).json()
    assert.equal(comparison.sources.find(s=>s.source==='netex').kinds.find(k=>k.kind==='Parking').count,1)
    const switched = await app.inject({method:'POST',url:'/admin/source',payload:{source:'netex'}})
    assert.equal(switched.statusCode,200)
    assert.equal(switched.json().active,'netex')
    assert.equal((await app.inject('/admin/explore/stops?poi_only=true')).json().total,1)
    const published = JSON.parse(await fs.readFile(`${root}/netex.db.active.json`,'utf8'))
    await db.prisma.importJob.update({where:{id:published.jobId},data:{status:'VALIDATING'}})
    await db.recoverImports('netex')
    assert.equal((await db.prisma.importJob.findUnique({where:{id:published.jobId}})).status,'COMPLETED')

    // Un nouveau conteneur Coolify doit pouvoir vérifier les migrations pendant
    // que l'ancien détient encore un verrou d'écriture sur la base partagée.
    const migrationCheck = await db.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('UPDATE DatasetMeta SET format = format')
      return promisify(execFile)(process.execPath, ['-e', "const db=require('./dist/db.js'); db.migrateDatabase(process.env.DATABASE_URL_NETEX).then(()=>console.log('ready')).catch(e=>{console.error(e);process.exit(1)})"], {env:process.env, timeout:10000})
    }, {timeout:15000})
    assert.match(migrationCheck.stdout, /ready/)
    assert.match(migrationCheck.stdout, /Migrations déjà appliquées/)

    await db.disconnectDatabases()
    const restarted = await promisify(execFile)(process.execPath, ['-e', "const db=require('./dist/db.js'); db.initDatabase().then(async()=>{console.log(JSON.stringify({source:db.getActiveSource(),trips:await db.prisma.trip.count()})); await db.disconnectDatabases()}).catch(e=>{console.error(e);process.exit(1)})"], {env:process.env})
    assert.deepEqual(JSON.parse(restarted.stdout.trim().split('\n').at(-1)),{source:'netex',trips:1})

  } finally {
    unblock?.()
    await app.close()
    await db.disconnectDatabases()
    if (process.env.KEEP_TEST_DATA) console.log('Fixture workspace:',root)
    else await fs.rm(root,{recursive:true,force:true})
  }
})
