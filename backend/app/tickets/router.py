"""Ticket endpoints.

Managing templates needs ``ticket.manage`` (``ADMIN`` by default) — back-
office configuration, no POS use case for it. Generating/reading a sale's
ticket reuses ``sale.read`` (``CASHIER`` already has it since phase 11) —
printing a receipt is just rendering a sale the cashier can already see,
not a new capability of its own.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import SessionDep, SettingsDep
from app.core.errors import ServiceUnavailableError
from app.rbac.dependencies import require_permission
from app.rbac.permissions import SALE_READ, TICKET_MANAGE
from app.tickets import qz_signing, service
from app.tickets.presenters import template_to_print_profile as _template_to_print_profile
from app.tickets.presenters import template_to_read as _template_to_read
from app.tickets.presenters import ticket_to_read as _ticket_to_read
from app.tickets.schemas import (
    QzSecurityRead,
    QzSignatureRead,
    QzSignRequest,
    TicketPrintProfileRead,
    TicketRead,
    TicketTemplateCreate,
    TicketTemplateRead,
    TicketTemplateUpdate,
)

router = APIRouter(tags=["tickets"])

_require_manage = Depends(require_permission(TICKET_MANAGE))
_require_sale_read = Depends(require_permission(SALE_READ))


@router.get(
    "/ticket-templates", response_model=list[TicketTemplateRead], dependencies=[_require_manage]
)
async def list_templates(session: SessionDep) -> list[TicketTemplateRead]:
    return [_template_to_read(t) for t in await service.list_templates(session)]


@router.post(
    "/ticket-templates",
    response_model=TicketTemplateRead,
    status_code=201,
    dependencies=[_require_manage],
)
async def create_template(payload: TicketTemplateCreate, session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.create_template(session, payload))


@router.get(
    "/ticket-templates/active",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def get_active_template(session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.get_active_template(session))


@router.get(
    "/ticket-templates/active/print-profile",
    response_model=TicketPrintProfileRead,
    dependencies=[_require_sale_read],
)
async def get_active_print_profile(session: SessionDep) -> TicketPrintProfileRead:
    """The active ticket's physical profile for POS documents such as Z.

    This is intentionally narrower than the template-management endpoint so
    a cashier can print correctly without being able to inspect or edit
    template configuration.
    """
    return _template_to_print_profile(await service.get_active_template(session))


@router.put(
    "/ticket-templates/{template_id}",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def update_template(
    template_id: int, payload: TicketTemplateUpdate, session: SessionDep
) -> TicketTemplateRead:
    return _template_to_read(await service.update_template(session, template_id, payload))


@router.post(
    "/ticket-templates/{template_id}/activate",
    response_model=TicketTemplateRead,
    dependencies=[_require_manage],
)
async def activate_template(template_id: int, session: SessionDep) -> TicketTemplateRead:
    return _template_to_read(await service.activate_template(session, template_id))


@router.delete(
    "/ticket-templates/{template_id}",
    status_code=204,
    dependencies=[_require_manage],
)
async def delete_template(template_id: int, session: SessionDep) -> None:
    await service.delete_template(session, template_id)


@router.post(
    "/sales/{sale_id}/tickets",
    response_model=TicketRead,
    status_code=201,
    dependencies=[_require_sale_read],
)
async def generate_ticket(sale_id: int, session: SessionDep) -> TicketRead:
    return _ticket_to_read(await service.generate_ticket(session, sale_id))


@router.get("/sales/{sale_id}/ticket", response_model=TicketRead, dependencies=[_require_sale_read])
async def get_ticket(sale_id: int, session: SessionDep) -> TicketRead:
    return _ticket_to_read(await service.get_ticket(session, sale_id))


@router.get(
    "/printing/qz/security", response_model=QzSecurityRead, dependencies=[_require_sale_read]
)
async def get_qz_security(settings: SettingsDep) -> QzSecurityRead:
    return QzSecurityRead(
        enabled=settings.qz_signing_enabled,
        certificate=settings.qz_signing_certificate if settings.qz_signing_enabled else None,
    )


@router.post("/printing/qz/sign", response_model=QzSignatureRead, dependencies=[_require_sale_read])
async def sign_qz_request(payload: QzSignRequest, settings: SettingsDep) -> QzSignatureRead:
    if not settings.qz_signing_enabled:
        raise ServiceUnavailableError("La firma silenciosa de QZ Tray no está configurada.")
    assert settings.qz_signing_certificate is not None
    assert settings.qz_signing_private_key is not None
    try:
        signature = qz_signing.sign_digest(
            settings.qz_signing_certificate,
            settings.qz_signing_private_key,
            payload.digest,
        )
    except ValueError as exc:
        raise ServiceUnavailableError(
            "El certificado de firma QZ configurado en el servidor no es válido."
        ) from exc
    return QzSignatureRead(signature=signature)
