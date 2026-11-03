"""生成并渲染 ADM 的可编辑 3D 图标；通过 Blender 后台 Python 执行。"""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "resources" / "branding"


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int)
    parser.add_argument("--samples", type=int)
    parser.add_argument("--output", type=Path, default=BRANDING / "adm-icon.png")
    parser.add_argument("--preview", action="store_true", help="只渲染预览，不覆盖模型源文件")
    parser.add_argument("--rebuild", action="store_true", help="依据 scene.json 重建并覆盖 Blender 模型")
    parser.add_argument("--update-style", action="store_true", help="仅同步机身与背板配色、相机构图，保留现有模型")
    parser.add_argument("--cpu", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def linear_color(hex_color):
    # Blender 节点使用线性颜色；配置文件保留设计师熟悉的 sRGB 十六进制色值。
    rgb = [int(hex_color.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb) + (1,)


def material(name, color, roughness=0.4, metal=0.0, coat=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    rgba = linear_color(color)
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Coat Weight"].default_value = coat
    shader.inputs["Coat Roughness"].default_value = 0.3
    shader.inputs["Emission Color"].default_value = rgba
    shader.inputs["Emission Strength"].default_value = emission
    mat.diffuse_color = rgba
    return mat


def collection(name):
    group = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(group)
    return group


def tile_material(color, edge_color):
    """根据背板真实法线生成柔和边缘，固定母版底色，避免摄影棚补光改变背板配色。"""
    mat = bpy.data.materials.new("背板 · 陶瓷边缘")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    geometry = nodes.new("ShaderNodeNewGeometry")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(geometry.outputs["Normal"], dot.inputs[0])
    links.new(geometry.outputs["Incoming"], dot.inputs[1])
    absolute = nodes.new("ShaderNodeMath")
    absolute.operation = "ABSOLUTE"
    links.new(dot.outputs["Value"], absolute.inputs[0])
    mix = nodes.new("ShaderNodeMixRGB")
    mix.inputs[1].default_value = linear_color(edge_color)
    mix.inputs[2].default_value = linear_color(color)
    links.new(absolute.outputs[0], mix.inputs[0])
    emission = nodes.new("ShaderNodeEmission")
    links.new(mix.outputs[0], emission.inputs[0])
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs[0], output.inputs["Surface"])
    mat.diffuse_color = linear_color(color)
    return mat


def move_to(obj, group):
    for previous in list(obj.users_collection):
        previous.objects.unlink(obj)
    group.objects.link(obj)
    return obj


def outline(width, height, radius, segments=20):
    """返回逆时针圆角矩形轮廓；宽高、圆角和采样数均以模型单位计。"""
    radius = min(radius, width / 2, height / 2)
    points = []
    for x, y, angle in (
        (width / 2 - radius, height / 2 - radius, 0),
        (-width / 2 + radius, height / 2 - radius, 90),
        (-width / 2 + radius, -height / 2 + radius, 180),
        (width / 2 - radius, -height / 2 + radius, 270),
    ):
        for index in range(segments + 1):
            a = math.radians(angle + 90 * index / segments)
            p = (x + radius * math.cos(a), y + radius * math.sin(a))
            if not points or math.dist(p, points[-1]) > 1e-7:
                points.append(p)
    if math.dist(points[0], points[-1]) < 1e-7:
        points.pop()
    return points


def prism(name, points, depth, group, mat=None):
    """把平面闭合轮廓挤出成实体网格，返回可编辑对象，不依赖 SVG 或纹理图片。"""
    count = len(points)
    vertices = [(x, y, z) for z in (-depth / 2, depth / 2) for x, y in points]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    group.objects.link(obj)
    if mat:
        mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return obj


def rounded(name, width, height, depth, radius, group, mat, bevel=0):
    obj = prism(name, outline(width, height, radius), depth, group, mat)
    if bevel:
        soften = obj.modifiers.new("边缘圆润过渡", "BEVEL")
        soften.width = bevel
        soften.segments = 5
        soften.limit_method = "ANGLE"
        soften.angle_limit = math.radians(35)
        soften.harden_normals = True
    normal = obj.modifiers.new("平面法线", "WEIGHTED_NORMAL")
    normal.keep_sharp = True
    normal.weight = 50
    return obj


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def subtract(obj, cutter):
    boolean = obj.modifiers.new("真实凹腔", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.solver = "EXACT"
    boolean.object = cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def cable(name, start, end, radius, mat, group):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(1)
    spline.points[0].co = (*start, 1)
    spline.points[1].co = (*end, 1)
    obj = bpy.data.objects.new(name, curve)
    group.objects.link(obj)
    curve.materials.append(mat)
    # 球形端帽保持标记触角的小尺寸圆润感。
    for index, point in enumerate((start, end)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=point)
        cap = move_to(bpy.context.object, group)
        cap.name = f"{name}_端帽_{index}"
        cap.data.materials.append(mat)
        for polygon in cap.data.polygons:
            polygon.use_smooth = True
    return obj


def build_model(config, group):
    """按 config 中的尺寸与材质建立实体，写入 group 集合并返回该集合。"""
    m, colors = config["model"], config["colors"]
    base_mat = material("底座 · 石墨哑光", colors["base"], 0.48, metal=0.05)
    screen_mat = material("屏幕 · 留白浅蓝玻璃", colors["screen"], 0.4, coat=0.08, emission=0.52)
    speaker_mat = material("听筒 · 深灰", colors["speaker"], 0.55)
    green = material("Android 标记 · 薄荷绿", colors["android"], 0.5, emission=0.35)

    base = rounded("Dock · 带三凹槽的底座", m["base_width"], m["base_depth"], m["base_height"],
                   m["base_radius"], group, base_mat, bevel=0.07)
    base.location.z = m["base_height"] / 2 + 0.025
    apply_modifiers(base)
    positions = [-m["device_spacing"], 0, m["device_spacing"]]
    for index, y in enumerate(positions):
        # 同一组中心和尺寸生成槽口与设备，左右余量相同；孔底低于机身底面。
        bottom = m["slot_floor"]
        top = m["base_height"] + 0.5
        cutter = prism(f"槽口切割_{index}", outline(m["slot_width"], m["slot_depth"], m["slot_depth"] / 2),
                       top - bottom, group)
        cutter.location = (0, y, (top + bottom) / 2)
        subtract(base, cutter)
    lip = base.modifiers.new("凹槽口倒角", "BEVEL")
    lip.width = 0.025
    lip.segments = 4
    lip.limit_method = "ANGLE"
    lip.harden_normals = True
    base.modifiers.new("凹腔平面法线", "WEIGHTED_NORMAL")

    for name, y, color in zip(("Front", "Middle", "Rear"), positions, ("front", "middle", "rear")):
        body_mat = material(f"{name} · 机身", colors[color], 0.4, coat=0.08, emission=0.12 if name == "Front" else 0)
        body_mat.node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value = 0.25
        body = rounded(f"{name} · 设备机身", m["device_width"], m["device_height"], m["device_depth"],
                       0.35, group, body_mat, bevel=0.045)
        body.rotation_euler.x = math.pi / 2
        body.location = (0, y, m["device_bottom"] + m["device_height"] / 2)
        screen = rounded(f"{name} · 屏幕", m["device_width"] - 0.36, m["device_height"] - 0.72,
                         0.014, 0.23, group, screen_mat, bevel=0.005)
        screen.rotation_euler.x = math.pi / 2
        screen.location = (0, y - m["device_depth"] / 2 - 0.008, body.location.z + 0.17)
        speaker = rounded(f"{name} · 听筒", 0.41, 0.125, 0.012, 0.058, group, speaker_mat, bevel=0.004)
        speaker.rotation_euler.x = math.pi / 2
        speaker.location = (0, screen.location.y - 0.012, m["device_bottom"] + m["device_height"] - 0.40)

    # 标记也使用实体网格，眼睛是真实镂空；署名保留于 README 和模型文本。
    radius, bottom = 0.34, 0.13
    points = [(radius * math.cos(math.pi * i / 64), radius * math.sin(math.pi * i / 64)) for i in range(65)]
    mark = prism("Android · 半圆头像", points, 0.009, group, green)
    mark.rotation_euler.x = math.pi / 2
    mark.location = (0, -m["base_depth"] / 2 - 0.003, bottom)
    for x in (-0.14, 0.14):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.05, depth=0.06,
                                           location=(x, mark.location.y, bottom + 0.15),
                                           rotation=(math.pi / 2, 0, 0))
        subtract(mark, bpy.context.object)
    for direction in (-1, 1):
        cable(f"Android · 触角_{direction}", (direction * 0.19, mark.location.y - 0.004, bottom + 0.27),
              (direction * 0.265, mark.location.y - 0.004, bottom + 0.405), 0.022, green, group)
    return group


def area_light(name, location, target, energy, size, group, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def configure_device(scene, cpu):
    """选择当前机器的渲染设备；不把保存 .blend 的机器所用 GPU 后端强加给另一平台。"""
    scene.cycles.device = "CPU"
    if cpu:
        return
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for backend in (("METAL",) if sys.platform == "darwin" else ("OPTIX", "CUDA", "HIP", "ONEAPI")):
        try:
            preferences.compute_device_type = backend
            preferences.get_devices()
            if any(device.type == backend for device in preferences.devices):
                for device in preferences.devices:
                    device.use = device.type == backend
                scene.cycles.device = "GPU"
                print(f"渲染后端：{backend}")
                return
        except (TypeError, RuntimeError):
            continue
    print("渲染后端：CPU")


def setup_scene(config, args):
    """用 config 设计参数和 args 输出选项创建完整场景，返回场景及模型集合。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples or config["render"]["samples"]
    scene.cycles.seed = config["render"]["seed"]
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.max_bounces = 8
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = args.size or config["render"]["size"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 70
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.world = bpy.data.worlds.new("柔和摄影棚环境")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.9, 1.0, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.3

    model_group = collection("01 · ADM 实体模型")
    studio = collection("02 · 摄影棚灯光")
    floor_group = collection("03 · 接触阴影")
    tile_group = collection("04 · 图标背板")
    cameras = collection("05 · 摄像机")
    build_model(config, model_group)

    cam = config["camera"]
    camera_data = bpy.data.cameras.new("Icon · 两点透视低视角")
    camera = bpy.data.objects.new("Icon · 主摄像机", camera_data)
    cameras.objects.link(camera)
    angle = math.radians(cam["azimuth"])
    camera.location = (math.sin(angle) * cam["distance"], -math.cos(angle) * cam["distance"], cam["height"])
    # 相机保持水平，利用移轴调整构图，让设备竖边保持平行而非向上汇聚。
    direction = Vector((0, 0, cam["height"])) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = cam["lens"]
    camera_data.shift_y = cam["shift_y"]
    camera_data.shift_x = cam["shift_x"]
    camera_data.clip_end = 200
    scene.camera = camera

    area_light("Key · 左上大柔光", (-4, -6, 9), (0, 0, 1.2), 400, 7, studio, (1, 0.96, 0.91))
    area_light("Fill · 右侧补光", (6, -1, 6), (0, 0, 1.2), 160, 6, studio, (0.86, 0.93, 1))
    area_light("Rim · 后上轮廓光", (-1, 5, 7), (0, 0, 1.4), 220, 5, studio)

    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = move_to(bpy.context.object, floor_group)
    floor.name = "Floor · 透明接触阴影"
    floor.is_shadow_catcher = True
    # 阴影平面保持中性，鲜艳背板不应通过间接反射把灰色底座染成背景色。
    floor.data.materials.append(material("地面 · 中性柔光", "#FAF9F5", 0.7))

    # 背板为相机正对的真实圆角实体。独立渲染层防止它挡住地面光线和模型阴影。
    distance = 36.0
    frame = distance * camera_data.sensor_width / camera_data.lens
    rotation = camera.rotation_euler.to_quaternion()
    forward = rotation @ Vector((0, 0, -1))
    up = rotation @ Vector((0, 1, 0))
    right = rotation @ Vector((1, 0, 0))
    plate = rounded("Tile · 圆角背板", frame * 0.87, frame * 0.85, 0.12, frame * 0.205,
                    tile_group, tile_material(config["colors"]["tile"], config["colors"]["tile_edge"]), bevel=0.065)
    plate.location = camera.location + forward * distance + up * (cam["shift_y"] * frame) + right * (cam["shift_x"] * frame)
    plate.rotation_euler = camera.rotation_euler

    model_layer = scene.view_layers[0]
    model_layer.name = "Model"
    model_layer.layer_collection.children[tile_group.name].exclude = True
    tile_layer = scene.view_layers.new("Tile")
    tile_layer.layer_collection.children[model_group.name].exclude = True
    tile_layer.layer_collection.children[floor_group.name].exclude = True
    scene.use_nodes = True
    nodes = scene.node_tree.nodes
    nodes.clear()
    background = nodes.new("CompositorNodeRLayers")
    background.layer = "Tile"
    background.location = (-420, 100)
    foreground = nodes.new("CompositorNodeRLayers")
    foreground.layer = "Model"
    foreground.location = (-420, -180)
    over = nodes.new("CompositorNodeAlphaOver")
    over.location = (-80, 100)
    scene.node_tree.links.new(background.outputs["Image"], over.inputs[1])
    scene.node_tree.links.new(foreground.outputs["Image"], over.inputs[2])
    # 阴影捕捉平面的采样噪声不应出现在背板以外；沿背板真实轮廓保留透明通道。
    mask = nodes.new("CompositorNodeSetAlpha")
    mask.mode = "REPLACE_ALPHA"
    mask.location = (160, 100)
    scene.node_tree.links.new(over.outputs["Image"], mask.inputs["Image"])
    scene.node_tree.links.new(background.outputs["Alpha"], mask.inputs["Alpha"])
    composite = nodes.new("CompositorNodeComposite")
    composite.location = (380, 100)
    scene.node_tree.links.new(mask.outputs["Image"], composite.inputs["Image"])

    # 打开 .blend 后直接进入图标相机视角；材质、槽口网格和灯光都可单独调整。
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
    return scene, model_group


def update_style(scene, config):
    """将 config 的机身、背板颜色和相机构图应用到 scene；保留几何与灯光，无返回值。"""
    cam, colors = config["camera"], config["colors"]
    for name in ("Front", "Middle", "Rear"):
        # 同步基础色与同色自发光，保留原材质的粗糙度、反射和强度，避免旧色残留。
        body = bpy.data.objects[f"{name} · 设备机身"].active_material
        shader = body.node_tree.nodes.get("Principled BSDF")
        rgba = linear_color(colors[name.lower()])
        shader.inputs["Base Color"].default_value = rgba
        shader.inputs["Emission Color"].default_value = rgba
        body.diffuse_color = rgba
    camera = scene.camera
    ratio = camera.data.lens / cam["lens"]
    camera.data.lens = cam["lens"]
    camera.data.shift_x = cam["shift_x"]
    camera.data.shift_y = cam["shift_y"]
    rotation = camera.rotation_euler.to_quaternion()
    forward, up, right = (rotation @ Vector(axis) for axis in ((0, 0, -1), (0, 1, 0), (1, 0, 0)))
    for plate in bpy.data.collections["04 · 图标背板"].objects:
        # 增加焦距只放大主体；按原焦距补偿背板尺寸，保持图标外轮廓及透明安全边距。
        distance = (plate.location - camera.location).dot(forward)
        frame = distance * camera.data.sensor_width / camera.data.lens
        plate.scale.x *= ratio
        plate.scale.y *= ratio
        plate.location = camera.location + forward * distance + up * (cam["shift_y"] * frame) + right * (cam["shift_x"] * frame)
        plate.data.materials.clear()
        plate.data.materials.append(tile_material(colors["tile"], colors["tile_edge"]))
        plate.name = "Tile · 圆角背板"


def main():
    """解析命令行后重建或读取场景，导出模型并渲染 PNG；失败由 Blender 返回非零状态。"""
    args = arguments()
    config = json.loads((BRANDING / "scene.json").read_text())
    blend_path = BRANDING / "adm-icon.blend"
    rebuild = args.rebuild or not blend_path.exists()
    if rebuild:
        scene, model_group = setup_scene(config, args)
    else:
        # 默认渲染已保存场景，保留设计师直接在 Blender 内调整的材质、造型和灯光。
        bpy.ops.wm.open_mainfile(filepath=str(blend_path))
        scene = bpy.context.scene
        model_group = bpy.data.collections["01 · ADM 实体模型"]
        if args.update_style:
            update_style(scene, config)
        if args.size:
            scene.render.resolution_x = scene.render.resolution_y = args.size
        if args.samples:
            scene.cycles.samples = args.samples
    configure_device(scene, args.cpu)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(args.output.resolve())
    # 先完成渲染再保存源场景和导出模型，避免 GPU 渲染失败时只更新一半设计资产。
    bpy.ops.render.render(write_still=True)
    if not args.preview:
        if rebuild or args.update_style:
            for path in (BRANDING / "scene.json", Path(__file__).resolve()):
                text = bpy.data.texts.get(path.name) or bpy.data.texts.new(path.name)
                text.clear()
                text.write(path.read_text())
            if rebuild:
                attribution = bpy.data.texts.new("Android attribution.txt")
                attribution.write("The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License. https://creativecommons.org/licenses/by/3.0/")
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
        # GLB 只包含可旋转查看的标志实体，不把图标背板和摄影棚当成模型一并导出。
        bpy.ops.object.select_all(action="DESELECT")
        for obj in model_group.objects:
            obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(BRANDING / "adm-icon.glb"), export_format="GLB",
                                  use_selection=True, export_apply=True, export_cameras=False, export_lights=False)
    print(f"ADM 图标渲染完成：{args.output}")


if __name__ == "__main__":
    main()
