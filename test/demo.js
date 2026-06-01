export const meta = {
  name: 'demo',
  description: 'A minimal workflow to verify the engine',
  phases: [
    { title: 'greet', detail: 'Say hello' },
  ],
}

phase('greet')
log('Hello from agentflow!')

const result = await agent('Respond with exactly the word "pong" and nothing else.')

log('Agent responded: ' + JSON.stringify(result))

return { ok: true, response: result }
