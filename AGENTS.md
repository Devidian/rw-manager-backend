# AGENTS.md

## Purpose

This file defines mandatory architectural, structural, and coding rules.

All agents MUST follow these rules when creating or modifying code.

These rules exist to ensure:

* deterministic code generation
* maintainability
* strict separation of concerns
* type safety
* validation safety

---

# Rule Priority

When rules conflict, follow this order:

1. Explicit user instruction
2. This AGENTS.md
3. Existing project code style

---

# Naming Conventions

## Files

**MUST**

Use kebab-case for ALL TypeScript files.

Examples:

```
user-service.ts
create-user-handler.ts
user-repository.ts
```

**MUST NOT**

```
userService.ts
UserService.ts
user_service.ts
```

---

## Naming by Responsibility

Use this naming schema:

| Type      | Pattern                  |
| --------- | ------------------------ |
| Router    | user-router.ts           |
| Handler   | create-user-handler.ts   |
| Service   | user-service.ts          |
| Mapper    | user-mapper.ts           |
| Interface | user.ts                  |
| DTO       | create-user-request.ts   |
| Validator | create-user-validator.ts |

---

# Folder Structure (MANDATORY)

```
/src

  /interfaces
  /dto
  /router
  /handler
  /service
  /mapper
  /validator
```

Agents MUST use this structure.

Agents MUST create folders if missing.

---

# Interfaces

## Location

**MUST**

All interfaces MUST be inside:

```
/src/interfaces
```

---

## Rules

**MUST**

* One interface per file
* File name matches interface name

Example:

```
/src/interfaces/user.ts
```

```
export interface User
```

---

**MUST NOT**

Declare inline object types.

Forbidden:

```ts
const user: { id: string }
```

---

# DTO Layer (MANDATORY)

DTOs define API request and response contracts.

Location:

```
/src/dto
```

Examples:

```
create-user-request.ts
create-user-response.ts
```

---

DTO MUST be used for:

* request body typing
* response typing

Handlers MUST use DTOs.

Services MUST NOT use Express Request or Response types.

---

# Typia Usage

## Required

Typia MUST be used for validation.

Example:

```ts
import typia from "typia"

const dto = typia.assert<CreateUserRequest>(req.body)
```

---

## UUID Example

```ts
import { Format } from "typia"

id: Format<"uuid">
```

---

## Forbidden

DO NOT use:

* zod
* joi
* manual validation

---

# Router Rules

Location:

```
/src/router
```

---

## Routers MUST

Contain ONLY:

* route definitions
* handler references

Example:

```ts
router.post("/users", createUserHandler)
```

---

## Routers MUST NOT contain

* business logic
* validation logic
* database logic

---

# Handler Rules

Location:

```
/src/handler
```

Handlers are responsible for:

* receiving request
* validating DTO
* calling service
* returning response

---

Handlers MUST NOT contain:

* business logic
* database logic

---

# Service Rules

Location:

```
/src/service
```

Services contain:

* business logic

Services MUST:

* be framework independent
* NOT import express

Forbidden:

```ts
req.body
res.send()
```

---

Services MUST return typed objects.

Example:

```ts
Promise<User>
```

---

# Mapper Rules

Location:

```
/src/mapper
```

Responsibility:

Transform between:

* DTO
* Interface
* Database
* Response

---

# Validator Rules

Location:

```
/src/validator
```

Optional.

Use when validation logic is reused.

---

# Error Handling Standard (MANDATORY)

Agents MUST use this pattern:

---

## Service Layer

Services MUST throw errors.

Example:

```ts
throw new Error("USER_NOT_FOUND")
```

---

## Handler Layer

Handlers MUST catch errors.

Example:

```ts
try {

} catch (error) {

  res.status(400).json({
    error: error.message
  })

}
```

---

## MUST NOT

Return errors from service like:

```ts
return { error: ... }
```

Services THROW errors.

Handlers HANDLE errors.

---

# Response Standard

Responses MUST use DTO.

Example:

```ts
const response: CreateUserResponse = {

}
```

---

# File Size Rule

If file exceeds 1000 lines:

Agents SHOULD split file.

Exception:

Classes may exceed 1000 lines.

---

# Strict Layer Isolation (CRITICAL)

Dependencies MUST follow this direction:

```
router
 → handler
   → service
     → mapper
       → interface
```

---

## Forbidden Reverse Dependencies

Service MUST NOT import:

```
handler
router
```

Handler MUST NOT import:

```
router
```

---

# Implementation Order (MANDATORY)

When implementing new feature, agents MUST follow:

Step 1:

Create Interface

Step 2:

Create DTO

Step 3:

Create Service

Step 4:

Create Mapper

Step 5:

Create Handler

Step 6:

Create Router

---

# Import Rules

Agents MUST use relative imports.

Example:

```
../service/user-service
```

---

# Type Safety Rules

Agents MUST

* use explicit types
* avoid any

Forbidden:

```
any
unknown (unless required)
```

---

# Forbidden Practices

Agents MUST NOT:

* use inline types
* mix responsibilities
* access database from handler
* access express from service
* skip DTO layer
* skip validation

---

# Agent Behavior Requirements

Agents MUST:

* create missing folders
* create missing DTOs
* create missing interfaces
* maintain architecture

Agents MUST NOT:

* simplify architecture
* merge layers

---

# Deterministic Code Rule

Agents MUST prefer:

* explicit code
* explicit types
* explicit return values

Agents MUST NOT rely on inference when avoidable.

---

# Summary

This architecture enforces:

* strict layering
* strict validation
* strict typing
* maintainable structure
* predictable agent behavior
