# Cable Management for ComfyUI

ComfyUI has spaghetti issues. This frontend extension offers daisy-chaining, PCB
routing, ribbon cables, and proper right-to-left wrapping support.

![a real workflow, combed](docs/hero.png)

> "WTF IS THAT?????" -- _"a bunch of reroutes in a trenchcoat"_

Built entirely from core ComfyUI primitives -- remove the extension and every
workflow made with it still loads and runs.

**Install Extension**

- ComfyUI Manager: search `Cable Management`, install, restart ComfyUI.
- Manual: `git clone https://github.com/vtokic/comfyui-cable-management` into
  `ComfyUI/custom_nodes/`, restart ComfyUI.

**Mandatory Settings**

- `Settings > Comfy > Nodes 2.0 > Modern Node Design (Nodes 2.0)` ON
- `Settings > Lite Graph > Graph > Link Render Mode` "PCB"

**Recommended Settings**

- `Settings > Lite Graph > Graph > Cable Management` ON (Modifies nodes' UI, enables passthrough and daisy-chaining)
- `Settings > Lite Graph > Link > Link midpoint markers` "Arrow"
- `Settings > Lite Graph > Link Release > Action on link release (No modifier)`
  "context menu" (Makes reroutes easier to create)

**Functionality**

- PCB Link Render Mode -- links do their best to path around nodes and avoid
  each other
- Cable Management -- node pin changes:
  - connected inputs get a pass-through pin on the opposite side of the node,
    for daisy-chaining
  - widgets get an output pin so their value can be pulled out as a primitive
  - outputs move to the bottom-right of the node (contract shape)
  - inputs and outputs collapse into drawers, hiding unconnected optional
    inputs and unused outputs
- Ribbons: stack reroutes on top of each other and they bundle into one
  ribbon cable
