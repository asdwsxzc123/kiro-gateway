import * as accountStore from './storage/accountStore.js'
import { callKiroApiStream, buildKiroPayload, mapModelId } from './core/kiroApi.js'
import { getRedisClient } from './storage/redis.js'

async function main() {
  // 初始化 Redis
  await getRedisClient()
  
  // 获取第一个可用账号
  const accounts = await accountStore.getAvailableAccounts()
  if (accounts.length === 0) {
    console.log('No accounts available')
    process.exit(1)
  }
  
  const account = accounts[0]
  console.log('Using account:', account.id)
  
  // 构建请求
  const payload = buildKiroPayload(
    'Say hello',
    mapModelId('claude-sonnet-4-20250514'),
    'AI_EDITOR',
    [],
    [],
    [],
    [],
    account.profileArn,
    { maxTokens: 10 }
  )
  
  console.log('\n--- Calling Kiro API ---\n')
  
  let allText = ''
  
  await new Promise<void>((resolve, reject) => {
    callKiroApiStream(
      account,
      payload,
      (text) => {
        allText += text
      },
      (usage) => {
        console.log('\n--- Final Usage from Kiro API ---')
        console.log(JSON.stringify(usage, null, 2))
        resolve()
      },
      (error) => {
        console.error('Error:', error)
        reject(error)
      }
    )
  })
  
  console.log('\nResponse text:', allText)
  process.exit(0)
}

main().catch(console.error)
