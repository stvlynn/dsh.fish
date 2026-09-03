# Application Layer

The application layer orchestrates use cases. It depends on the domain layer and on domain-defined ports, but not on concrete infrastructure.

## What belongs in `application/`

- **Application services** — one per use case or per aggregate. They coordinate entities, domain services, repositories, and external services.
- **DTOs** — data-transfer objects for inputs and outputs at the application boundary.
- **Commands and queries** — lightweight objects representing incoming requests.
- **Transaction boundaries** — a unit of work that spans multiple domain operations.
- **Background-work ports** — durable work is requested through an application
  interface such as `ReadmeLocalizationScheduler`; use cases never import a
  queue, Worker binding or Agent SDK.
- **Catalog facet cache** — `ListCatalogFacets` reads an optional
  `CatalogFacetCache` before the three count queries. The cache is a catalog-wide
  snapshot, not a per-URL entry.
- **Backfill orchestration** — `BackfillReadmeLocalization` pages over a small
  README projection and advances a durable cursor only after every item on the
  page has been accepted by the scheduler. Each run also reschedules a bounded
  batch of stale terminal failures, which the forward-only cursor would never
  revisit on its own.
- **Artifact ask** — `AskArtifact` loads a GitHub-sourced artifact, enforces
  the feature flag and KV budgets, then delegates to `ArtifactAskPort`. It
  returns a `queryId` plus an `AsyncIterable` of mapped events (`file`,
  `delta`, `cite`, `done`, `error`). No transcript is persisted.

## Rules

- Application services contain no business rules. They delegate to domain entities and services.
- Application services are framework-agnostic. They do not access HTTP request/response objects.
- One application service method should represent one use case.
- Return DTOs, not raw domain entities, when crossing the application boundary.

## Example

```ts
// application/place-order/place-order-service.ts
export class PlaceOrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly inventoryService: InventoryPort,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<OrderDto> {
    const order = Order.create(command.customerId, command.items);

    for (const item of order.items) {
      await this.inventoryService.reserve(item.productId, item.quantity);
    }

    await this.orderRepository.save(order);

    return OrderDto.from(order);
  }
}
```

## Transaction boundaries

- A single use case should be one transaction.
- Define the unit-of-work abstraction in `domain/` if multiple aggregates are involved.
- Implement the unit of work in `infrastructure/`.

## Cross-cutting concerns

- Logging, metrics, and authorization can be handled via decorators, middleware, or explicit service wrappers. Keep them thin and do not let them hide domain logic.
