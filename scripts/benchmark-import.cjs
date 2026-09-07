// Disposable benchmark. Never uses the configured production databases or RFU credentials.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maasterplan-bench-'))
  Object.assign(process.env, { DATABASE_URL:`file:${root}/gtfs.db`, DATABASE_URL_GTFS:`file:${root}/gtfs.db`, DATABASE_URL_NETEX:`file:${root}/netex.db`, RFU_API_TOKEN:'fixture', NODE_ENV:'test', AUTO_IMPORT_ON_START:'false', SIRI_VM_ENABLED:'false', TMP_DIR:`${root}/tmp` })
  const db = require('../dist/db.js')
  const { runImportInWorker } = require('../dist/import-runner.js')
  const { buildServer } = require('../dist/server.js')
  const source = process.env.BENCH_SOURCE === 'netex' ? 'netex' : 'gtfs'
  const rows = Math.max(1000, Math.min(Number(process.env.BENCH_ROWS) || 100000, 1000000))
  const feed = path.join(root,'feed')
  await fs.mkdir(feed)
  const files = {
    'agency.txt':'agency_id,agency_name,agency_url,agency_timezone\na,Benchmark,https://example.org,Europe/Paris\n',
    'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\ns,Stop,45,4\n',
    'routes.txt':'route_id,agency_id,route_short_name,route_type\nr,a,01,3\n',
    'calendar_dates.txt':'service_id,date,exception_type\nc,20260907,1\n',
  }
  for (const [file,data] of Object.entries(source === 'gtfs' ? files : {})) await fs.writeFile(path.join(feed,file),data)
  async function makeFeed(count) {
    if (source === 'netex') {
      async function* xml() {
        yield '<PublicationDelivery><CompositeFrame id="frame"><members><Operator id="a"><Name>Benchmark</Name></Operator><StopPlace id="station"><Name>Station</Name><quays><Quay id="s"><Name>Stop</Name></Quay></quays></StopPlace><PointOfInterest id="poi"><Name>Parking</Name></PointOfInterest><Line id="r"><Name>Line</Name><PublicCode>01</PublicCode><TransportMode>bus</TransportMode><OperatorRef ref="a"/></Line><Route id="route"><LineRef ref="r"/></Route><PassengerStopAssignment id="assignment"><ScheduledStopPointRef ref="ssp"/><QuayRef ref="s"/></PassengerStopAssignment><ServiceJourneyPattern id="pattern"><RouteRef ref="route"/><pointsInSequence>'
        for(let point=0;point<100;point++) yield `<StopPointInJourneyPattern id="p${point}" order="${point+1}"><ScheduledStopPointRef ref="ssp"/></StopPointInJourneyPattern>`
        yield '</pointsInSequence></ServiceJourneyPattern><DayType id="c"/><DayTypeAssignment id="date"><DayTypeRef ref="c"/><Date>2026-09-07</Date></DayTypeAssignment>'
        for(let start=0;start<count;start+=100) {
          yield `<ServiceJourney id="t${start/100}"><LineRef ref="r"/><ServiceJourneyPatternRef ref="pattern"/><dayTypes><DayTypeRef ref="c"/></dayTypes><passingTimes>`
          for(let point=0;point<Math.min(100,count-start);point++) yield `<TimetabledPassingTime id="time${start+point}"><StopPointInJourneyPatternRef ref="p${point}"/><DepartureTime>08:00:00</DepartureTime></TimetabledPassingTime>`
          yield '</passingTimes></ServiceJourney>'
        }
        yield '</members></CompositeFrame></PublicationDelivery>'
      }
      await pipeline(Readable.from(xml()),require('node:fs').createWriteStream(path.join(feed,'complete.xml')))
      return
    }
    await fs.writeFile(path.join(feed,'trips.txt'),'route_id,service_id,trip_id\n'+Array.from({length:Math.ceil(count/100)},(_,i)=>`r,c,t${i}\n`).join(''))
    async function* lines() {
      yield 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
      for (let start=0;start<count;start+=1000) yield Array.from({length:Math.min(1000,count-start)},(_,offset)=>{const i=start+offset;return `t${Math.floor(i/100)},08:00:00,08:00:00,s,${i%100+1}\n`}).join('')
    }
    await pipeline(Readable.from(lines()),require('node:fs').createWriteStream(path.join(feed,'stop_times.txt')))
  }
  for (const source of ['gtfs','netex']) await db.ensureSourceDatabase(source)
  await db.setActiveSource(source)
  await makeFeed(100)
  await runImportInWorker(source,'manual',true,feed)
  const app = await buildServer()
  const url = await app.listen({host:'127.0.0.1',port:0})
  await makeFeed(rows)
  const health=[], routes=[]
  let peakTreeRss=0, inFlight=false, failure
  async function rss(pid) {
    let total=0
    try {
      const text=await fs.readFile(`/proc/${pid}/status`,'utf8')
      total=Number(text.match(/VmRSS:\s+(\d+)/)?.[1]??0)*1024
      const children=(await fs.readFile(`/proc/${pid}/task/${pid}/children`,'utf8')).trim().split(/\s+/).filter(Boolean)
      for (const child of children) total+=await rss(child)
    } catch { /* process may exit between reads */ }
    return total
  }
  async function probe() {
    if(inFlight) return
    inFlight=true
    try {
      const begin=performance.now();const h=await fetch(url+'/health');assert.equal(h.status,200);await h.arrayBuffer();health.push(performance.now()-begin)
      const before=performance.now();const r=await fetch(url+'/admin/explore/routes');assert.equal(r.status,200);assert.equal((await r.json()).total,1);routes.push(performance.now()-before)
      peakTreeRss=Math.max(peakTreeRss,await rss(process.pid))
    } catch(error) {failure=error} finally {inFlight=false}
  }
  const interval=setInterval(()=>void probe(),50)
  const started=performance.now()
  try {
    await runImportInWorker(source,'manual',true,feed)
    assert.equal(await db.prisma.stopTime.count(),rows)
    if(failure) throw failure
    const report=list=>{list.sort((a,b)=>a-b);return {samples:list.length,p95Ms:+(list[Math.floor(list.length*.95)]??0).toFixed(1),maxMs:+(list.at(-1)??0).toFixed(1)}}
    console.log(JSON.stringify({source,rows,durationSeconds:+((performance.now()-started)/1000).toFixed(2),peakProcessTreeRssMiB:+(peakTreeRss/1024**2).toFixed(1),health:report(health),routeList:report(routes)},null,2))
  } finally {
    clearInterval(interval)
    while(inFlight) await new Promise(resolve=>setTimeout(resolve,10))
    await app.close();await db.disconnectDatabases();await fs.rm(root,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exit(1)})
