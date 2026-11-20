import { describe, expect, it } from 'vitest'
import { capabilityChip, continuityChip, logChips, ticketChip } from './ticket-state'

describe('探针只给疑似，不给结论降智', () => {
  it('6 系探针 degraded → 疑降智（warn），不是降智', () => {
    const chip = continuityChip({ model: 'gpt-6.2-astra', probeVerdict: 'degraded' })
    expect(chip.label).toBe('疑降智')
    expect(chip.tone).toBe('warn')
  })

  it('低阶模型探针 degraded → 断票', () => {
    const chip = continuityChip({ model: 'gpt-5.6-luna', probeVerdict: 'degraded' })
    expect(chip.label).toBe('断票')
    expect(chip.tone).toBe('bad')
  })

  it('探针 healthy → 可续（不再叫满血）', () => {
    const chip = continuityChip({ model: 'gpt-6.2-astra', probeVerdict: 'healthy' })
    expect(chip.label).toBe('可续')
  })
})

describe('能力题才是满血/降智的唯一来源', () => {
  it('candy pass → 满血', () => {
    expect(capabilityChip({ model: 'gpt-6.2-astra', capabilityVerdict: 'pass' })?.label).toBe('满血')
  })

  it('candy fail → 降智', () => {
    const chip = capabilityChip({ model: 'gpt-6.2-astra', capabilityVerdict: 'fail' })
    expect(chip?.label).toBe('降智')
    expect(chip?.tone).toBe('bad')
  })

  it('低阶模型不做能力判定', () => {
    expect(capabilityChip({ model: 'gpt-5.6-luna', capabilityVerdict: 'pass' })).toBeNull()
  })
})

describe('组合', () => {
  it('票 ok + 探针 degraded + 能力 pass：三个徽标并存', () => {
    const chips = logChips({
      model: 'gpt-6.2-astra',
      ticketVerdict: 'ok',
      ticketLen: 780,
      probeVerdict: 'degraded',
      capabilityVerdict: 'pass',
    })
    expect(chips.map((c) => c.label)).toEqual(['有票·780·断', '疑降智', '满血'])
  })

  it('无票时票徽标如实显示', () => {
    expect(ticketChip({ model: 'gpt-6.2-astra', ticketVerdict: 'absent' }).label).toBe('无票')
  })
})
