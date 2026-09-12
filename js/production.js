/**
 * production.js — the production queue.
 *
 * Production handles severely damaged returns that cannot be fixed in the
 * repair bay. Those units are already counted inside the damaged figure, so
 * this screen tracks rebuild progress without ever adding to return quantity.
 */
Views.production = QueueView.build({
  key: 'production',
  title: 'Production queue',
  subtitle: 'Badly damaged units being rebuilt. These are part of the damaged count, not extra units.',
  listAction: 'getProductionQueue',
  updateAction: 'updateProductionStatus',
  dataset: 'production',
  canUpdate: function () { return Auth.can('canProduce'); },
  emptyTitle: 'No pending production items.',
  emptyHint: 'Damaged units sent to production will appear here.'
});
