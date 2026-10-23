import bpy, sys, math
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
OUT, MODO, ALTO = args[0], args[1], int(args[2])
GROSOR = float(args[3]) if len(args) > 3 else 3.0
CREASE = float(args[4]) if len(args) > 4 else 150.0
scene = bpy.context.scene
FUERA = ('Muro', 'Piso', 'Guardapolvo', 'Mascara')
def es_puerta(o):
    if o.type != 'MESH' or o.name.startswith(FUERA): return False
    cols = [c.name for c in o.users_collection]
    if any(c in ('Muro_tmp', 'Estudio_cycles') for c in cols): return False
    if MODO == 'marco': return any(c.endswith(' Marco') for c in cols)
    return True
visibles = []
for o in scene.objects:
    if o.type == 'LIGHT': o.hide_render = True; continue
    if o.type == 'MESH':
        v = es_puerta(o); o.hide_render = not v
        if v: visibles.append(o)
dg = bpy.context.evaluated_depsgraph_get()
pts = [o.matrix_world @ Vector(c) for o in visibles for c in o.evaluated_get(dg).bound_box]
x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
y0 = min(p.y for p in pts)
w, h = x1 - x0, z1 - z0
m = 0.012 * h
cam_data = bpy.data.cameras.new('Plano'); cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('Plano', cam_data); scene.collection.objects.link(cam)
cam.location = ((x0 + x1) / 2, y0 - 5, (z0 + z1) / 2); cam.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = cam
r = scene.render
r.resolution_y = ALTO; r.resolution_x = int(ALTO * (w + 2 * m) / (h + 2 * m)); r.resolution_percentage = 100
cam_data.ortho_scale = h + 2 * m if (h >= w) else w + 2 * m
if r.resolution_x > r.resolution_y: cam_data.sensor_fit = 'HORIZONTAL'
else: cam_data.sensor_fit = 'VERTICAL'
r.engine = 'BLENDER_EEVEE'; r.film_transparent = True
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'
r.use_freestyle = True; r.line_thickness_mode = 'ABSOLUTE'; r.line_thickness = GROSOR
vl = bpy.context.view_layer; vl.use_solid = False; vl.use_freestyle = True
fs = vl.freestyle_settings; fs.crease_angle = math.radians(CREASE); fs.use_culling = False
for ls in list(fs.linesets): fs.linesets.remove(ls)
ls = fs.linesets.new('Trazo')
ls.select_by_visibility = True; ls.visibility = 'VISIBLE'; ls.select_by_edge_types = True
for k in ('select_silhouette', 'select_border', 'select_crease', 'select_external_contour', 'select_material_boundary'):
    setattr(ls, k, True)
st = ls.linestyle; st.color = (0.176, 0.286, 0.22); st.thickness = GROSOR; st.caps = 'ROUND'
scene.view_settings.view_transform = 'Standard'
r.filepath = OUT
bpy.ops.render.render(write_still=True)
hoja = [o for o in visibles if any(c.name.endswith(' Hoja') for c in o.users_collection)]
import json
if hoja:
    hp = [o.matrix_world @ Vector(c) for o in hoja for c in o.evaluated_get(dg).bound_box]
    W_, H_ = w + 2 * m, h + 2 * m
    caja = {'izq': (min(p.x for p in hp) - x0 + m) / W_, 'der': (max(p.x for p in hp) - x0 + m) / W_,
            'arriba': (z1 + m - max(p.z for p in hp)) / H_, 'abajo': (z1 + m - min(p.z for p in hp)) / H_,
            'ancho_mm': round((max(p.x for p in hp) - min(p.x for p in hp)) * 1000), 'alto_mm': round((max(p.z for p in hp) - min(p.z for p in hp)) * 1000)}
else: caja = None
print('DIBUJO', json.dumps({'archivo': OUT, 'px': [r.resolution_x, r.resolution_y], 'hoja': caja}))
