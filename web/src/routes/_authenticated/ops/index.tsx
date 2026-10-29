import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/ops/')({
  beforeLoad: () => {
    throw redirect({ to: '/ops/$tab', params: { tab: 'ticket' } })
  },
})
