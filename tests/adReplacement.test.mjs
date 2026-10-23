import test from 'node:test'
import assert from 'node:assert/strict'
import { AdReplacement, isAdMarker, useAdReplacement } from '../src/audio/AdReplacement.ts'
import { cleanTitle, parseIcyMetadata } from '../src/nowplaying/parse.ts'

test('explicit break labels survive metadata parsing; song names do not trigger replacement', () => {
  for (const marker of ['advert', 'commercial', 'Ad Break', 'Advertisement', 'Commercial break: sponsor']) {
    assert.equal(isAdMarker(marker), true)
    assert.equal(cleanTitle(marker), marker)
    assert.equal(parseIcyMetadata(`StreamTitle='${marker}';`), marker)
  }
  for (const song of ['Boards of Canada - Music Has the Right to Children', 'Artist - Advertisement', 'Radiohead - No Surprises', 'Commercial Success']) assert.equal(isAdMarker(song), false)
})

test('opt-in, automatic return, manual override, timeout and station cleanup', async () => {
  const calls = []
  const filter = new AdReplacement((active) => calls.push(active), 20)
  const disconnect = filter.connect()
  try {
    filter.title('Ad break')
    assert.equal(useAdReplacement.getState().replacing, false)
    useAdReplacement.getState().setEnabled(true)
    assert.equal(calls.at(-1), true)
    filter.title('Artist - Song')
    assert.equal(calls.at(-1), false)
    filter.replaceNow()
    assert.equal(calls.at(-1), true)
    filter.restore()
    filter.title('Artist - Song')
    assert.equal(calls.at(-1), false)
    filter.title('Commercial')
    await new Promise((resolve) => setTimeout(resolve, 35))
    assert.equal(calls.at(-1), false)
    filter.title('Commercial')
    assert.equal(calls.at(-1), false, 'stale marker cannot retrigger after timeout')
    filter.replaceNow()
    filter.reset()
    assert.equal(calls.at(-1), false)
    filter.replaceNow()
    useAdReplacement.getState().setEnabled(false)
    assert.equal(calls.at(-1), false)
  } finally {
    disconnect()
    useAdReplacement.getState().setEnabled(false)
  }
})
