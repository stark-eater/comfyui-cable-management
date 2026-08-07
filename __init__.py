"""Cable Management -- What Goes In Must Come Out.

A nodeless ComfyUI frontend extension. This shim exists only because ComfyUI's loader
unconditionally exec_module()s __init__.py before it will look at a web directory --
there is no pure-JS install path. It registers no nodes.
"""

WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
