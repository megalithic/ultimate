import { expect, it } from 'vitest'
import { openableUrl } from '../../elsewhere.solid.tsx'

it('opens another instance at its loopback address from loopback, else at its own tailnet address', () => {
  const found = {
    url: 'http://127.0.0.1:4747',
    label: 'my-app on this machine',
    name: 'my-app',
    tailnet: 'https://desk.example.ts.net:4747',
  }
  expect(openableUrl(found, new URL('http://127.0.0.1:4749/'))).toBe(found.url)
  expect(openableUrl(found, new URL('http://localhost:4749/'))).toBe(found.url)
  const phone = new URL('https://desk.example.ts.net:4749/')
  expect(openableUrl(found, phone)).toBe(found.tailnet)
  expect(openableUrl({ ...found, tailnet: undefined }, phone)).toBeUndefined()
  const remote = {
    ...found,
    url: 'https://laptop.example.ts.net:4749',
    tailnet: undefined,
  }
  expect(openableUrl(remote, phone)).toBe(remote.url)
})
