import { createFileRoute } from '@tanstack/react-router'
import { IqResultsPage } from '@/features/ops/iq-results'

export const Route = createFileRoute('/_authenticated/ops/results')({
  component: IqResultsPage,
})
