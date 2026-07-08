"""Agent dialogue routes for memory-scoped persona review."""

import json

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context
from loguru import logger


agents_bp = Blueprint("agents", __name__, url_prefix="/api/agents")


@agents_bp.route("/dialogue", methods=["POST"])
def create_agent_dialogue():
    """Create a one-off Luoyi-hosted multi-persona review session."""
    try:
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            data = {}

        service = current_app.services.agent_dialogue_service
        if data.get("stream"):
            return _stream_dialogue(service, data)

        session = service.create_dialogue(data)
        return jsonify({"success": True, "data": {"session": session}})
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
    except Exception as exc:
        logger.exception(f"/api/agents/dialogue failed: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


def _stream_dialogue(service, data):
    @stream_with_context
    def generate():
        try:
            for item in service.create_dialogue_stream(data):
                yield _sse_event(item["event"], item.get("data", {}))
        except ValueError as exc:
            yield _sse_event("error", {"success": False, "message": str(exc)})
        except Exception as exc:
            logger.exception(f"/api/agents/dialogue stream failed: {exc}")
            yield _sse_event("error", {"success": False, "message": str(exc)})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _sse_event(event, payload):
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"