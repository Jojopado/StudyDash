# 兩張動作照片 → 偵測人體關節 → 沿骨架角度補間 → 三角網格變形＋交叉淡化 → 多格動畫 WebP
# 用法：python morph.py <輸出資料夾> <名稱...>   （名稱＝img/ex 的 <名稱>-0.jpg / -1.jpg）
import sys, os, json, math
import numpy as np, cv2
from PIL import Image
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

SRC = r'C:\Users\newto\StudyDash\img\ex'
HERE = os.path.dirname(os.path.abspath(__file__))
N = 8            # 單程格數（含頭尾；偶數才不會有一張剛好 50/50 的殘影）
W = 600          # 輸出寬度
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=os.path.join(HERE, 'pose_heavy.task')), num_poses=1,
    min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3))

# 骨架：(子, 父)；'H' = 兩髖中點（根）、'S' = 兩肩中點
BONES = [('S', 'H'), (23, 'H'), (24, 'H'), (25, 23), (26, 24), (27, 25), (28, 26), (29, 27), (30, 28), (31, 27), (32, 28),
         (11, 'S'), (12, 'S'), (13, 11), (14, 12), (15, 13), (16, 14), (19, 15), (20, 16), (0, 'S')]
SWAP = {11: 12, 13: 14, 15: 16, 19: 20, 23: 24, 25: 26, 27: 28, 29: 30, 31: 32}
SWAP.update({v: k for k, v in SWAP.items()})

def detect(img):
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
    if not r.pose_landmarks: return None
    h, w = img.shape[:2]
    lm = r.pose_landmarks[0]
    pts = {i: np.array([lm[i].x * w, lm[i].y * h]) for i in range(33)}
    pts['H'] = (pts[23] + pts[24]) / 2
    pts['S'] = (pts[11] + pts[12]) / 2
    vis = np.mean([lm[i].visibility for i in (11, 12, 23, 24, 13, 14, 25, 26)])
    return pts, vis

def swapped(p):
    q = {k: (p[SWAP[k]] if k in SWAP else p[k]) for k in p}
    return q

def lerp_pose(A, B, t):
    # 根位置線性內插，其餘每根骨頭內插角度和長度（手臂彎舉才會畫弧線，不會縮短）
    P = {'H': A['H'] * (1 - t) + B['H'] * t}
    for c, par in BONES:
        va, vb = A[c] - A[par], B[c] - B[par]
        aa, ab = math.atan2(va[1], va[0]), math.atan2(vb[1], vb[0])
        d = (ab - aa + math.pi) % (2 * math.pi) - math.pi
        ang = aa + d * t
        ln = np.linalg.norm(va) * (1 - t) + np.linalg.norm(vb) * t
        P[c] = P[par] + ln * np.array([math.cos(ang), math.sin(ang)])
    return P

# 四肢寬度（佔骨頭長度的比例）：骨頭兩側加點，四肢才會整塊轉動、不會被拉胖
WID = {13: .16, 14: .16, 15: .13, 16: .13, 25: .22, 26: .22, 27: .16, 28: .16, 0: .45}

def ctrl(P, w, h):
    # 控制點：關節＋骨頭上的 1/3、2/3 點＋四肢兩側＋軀幹格子＋畫面邊框（背景不動）
    pts = [P[c] for c, _ in BONES] + [P['H']]
    for c, par in BONES:
        for f in (1 / 3, 2 / 3): pts.append(P[par] * (1 - f) + P[c] * f)
        if c in WID:
            v = P[c] - P[par]; n = np.array([-v[1], v[0]]) * WID[c]
            for f in (0.25, 0.75):
                m = P[par] * (1 - f) + P[c] * f
                pts += [m + n, m - n]
    # 軀幹：兩肩、兩髖圍成的四邊形裡放 3×3 格子，讓身體整塊跟著動
    q = [P[11], P[12], P[24], P[23]]
    for u in (0.2, 0.5, 0.8):
        for v in (0.2, 0.5, 0.8):
            top = q[0] * (1 - u) + q[1] * u; bot = q[3] * (1 - u) + q[2] * u
            pts.append(top * (1 - v) + bot * v)
    for x in np.linspace(0, w - 1, 5):
        pts += [np.array([x, 0]), np.array([x, h - 1])]
    for y in np.linspace(0, h - 1, 5)[1:-1]:
        pts += [np.array([0, y]), np.array([w - 1, y])]
    return np.array(pts, dtype=np.float32)

def warp(img, src, dst, tris):
    out = np.zeros_like(img)
    for t in tris:
        s, d = src[t], dst[t]
        r = cv2.boundingRect(d)
        x, y, rw, rh = r
        if rw <= 0 or rh <= 0: continue
        dl = (d - [x, y]).astype(np.float32)
        M = cv2.getAffineTransform(s.astype(np.float32), dl)
        patch = cv2.warpAffine(img, M, (rw, rh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        mask = np.zeros((rh, rw), np.uint8)
        cv2.fillConvexPoly(mask, np.int32(np.round(dl)), 255)
        H, Wd = out.shape[:2]
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + rw, Wd), min(y + rh, H)
        if x1 <= x0 or y1 <= y0: continue
        sub = out[y0:y1, x0:x1]
        m = mask[y0 - y:y1 - y, x0 - x:x1 - x] > 0
        sub[m] = patch[y0 - y:y1 - y, x0 - x:x1 - x][m]
    return out

def delaunay(pts, w, h):
    from scipy.spatial import Delaunay
    clipped = np.clip(pts, [0, 0], [w - 1, h - 1]).astype(np.float32)
    return Delaunay(clipped).simplices, clipped

def align(im0, im1, A, B):
    # 兩張照片鏡頭位置不一樣 → 用背景特徵點算單應矩陣，把第二張對齊到第一張（人身上的點不算）
    h, w = im0.shape[:2]
    def mask(P):
        m = np.full((h, w), 255, np.uint8)
        xs = [P[k][0] for k in P]; ys = [P[k][1] for k in P]
        pad = 0.12 * w
        cv2.rectangle(m, (int(min(xs) - pad), int(min(ys) - pad)), (int(max(xs) + pad), int(max(ys) + pad)), 0, -1)
        return m
    orb = cv2.ORB_create(3000)
    g0, g1 = cv2.cvtColor(im0, cv2.COLOR_RGB2GRAY), cv2.cvtColor(im1, cv2.COLOR_RGB2GRAY)
    k0, d0 = orb.detectAndCompute(g0, mask(A)); k1, d1 = orb.detectAndCompute(g1, mask(B))
    if d0 is None or d1 is None or len(k0) < 30 or len(k1) < 30: return im1, B, False
    ms = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d0), key=lambda m: m.distance)[:400]
    if len(ms) < 30: return im1, B, False
    src = np.float32([k1[m.queryIdx].pt for m in ms]); dst = np.float32([k0[m.trainIdx].pt for m in ms])
    Hm, inl = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if Hm is None or inl.sum() < 25: return im1, B, False
    sc = math.sqrt(abs(np.linalg.det(Hm[:2, :2])))
    if not 0.75 < sc < 1.33: return im1, B, False
    im1a = cv2.warpPerspective(im1, Hm, (w, h), borderMode=cv2.BORDER_REPLICATE)
    B2 = {k: cv2.perspectiveTransform(np.float32([[v]]), Hm)[0, 0].astype(float) for k, v in B.items()}
    return im1a, B2, True

def badness(src, dst, tris):
    # 三角形翻面或面積變化太大＝會出現怪變形
    def area(P, t):
        a, b, c = P[t[:, 0]], P[t[:, 1]], P[t[:, 2]]
        return 0.5 * ((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))
    s, d = area(src, tris), area(dst, tris)
    big = np.abs(s) > 20
    flip = np.mean((np.sign(s) != np.sign(d))[big]) if big.any() else 0
    ratio = np.abs(d[big]) / np.abs(s[big]) if big.any() else np.array([1])
    stretch = np.mean((ratio > 3.5) | (ratio < 0.28))
    return max(flip, stretch * 0.5)

def make(name, outdir, force_fade=False):
    im0 = np.array(Image.open(os.path.join(SRC, f'{name}-0.jpg')).convert('RGB'))
    im1 = np.array(Image.open(os.path.join(SRC, f'{name}-1.jpg')).convert('RGB'))
    if im1.shape != im0.shape: im1 = cv2.resize(im1, (im0.shape[1], im0.shape[0]))
    h, w = im0.shape[:2]
    a, b = detect(im0), detect(im1)
    frames = []
    mode = 'crossfade'
    if not force_fade and a and b and min(a[1], b[1]) > 0.35:
        A, B = a[0], b[0]
        # 左右被認反：選關節移動比較少的那個
        cost = lambda X, Y: sum(np.linalg.norm(X[k] - Y[k]) for k in SWAP)
        if cost(A, swapped(B)) < cost(A, B) * 0.8: B = swapped(B)
        im1, B, ok = align(im0, im1, A, B)
        mode = 'morph+align' if ok else 'morph'
        worst = 0
        for k in range(N):
            t = k / (N - 1)
            ts = t * t * (3 - 2 * t)  # 頭尾慢、中間快
            P = lerp_pose(A, B, ts)
            dst = ctrl(P, w, h)
            tris, dstc = delaunay(dst, w, h)
            cA, cB = np.clip(ctrl(A, w, h), [0, 0], [w - 1, h - 1]), np.clip(ctrl(B, w, h), [0, 0], [w - 1, h - 1])
            worst = max(worst, badness(cA, dstc, tris), badness(cB, dstc, tris))
            w0 = warp(im0, cA, dstc, tris)
            w1 = warp(im1, cB, dstc, tris)
            al = min(1.0, max(0.0, (ts - 0.35) / 0.3)); al = al * al * (3 - 2 * al)  # 只在中間一小段交叉淡化，殘影比較少
            frames.append(cv2.addWeighted(w0, 1 - al, w1, al, 0))
        if worst > 0.6:
            mode, frames = f'fade({worst:.2f})', []
    if not frames:
        # 變形會怪 → 頭尾各停住、中間快速淡入淡出
        for k in range(N):
            t = k / (N - 1)
            al = min(1.0, max(0.0, (t - 0.3) / 0.4))
            frames.append(cv2.addWeighted(im0, 1 - al, im1, al, 0))
    # 來回：0..N-1..1，頭尾停久一點
    seq = frames + frames[-2:0:-1]
    dur = [380 if i in (0, N - 1) else 75 for i in range(N)] + [75] * (N - 2)
    pil = [Image.fromarray(f).resize((W, round(h * W / w)), Image.LANCZOS) for f in seq]
    path = os.path.join(outdir, f'{name}.webp')
    pil[0].save(path, save_all=True, append_images=pil[1:], duration=dur, loop=0, quality=72, method=5)
    return mode, round(min(a[1], b[1]) if a and b else 0, 2), os.path.getsize(path) // 1024

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    res = {}
    for n in sys.argv[2:]:
        try:
            res[n] = make(n.lstrip('!'), out, n.startswith('!'))
        except Exception as e:
            res[n] = ('error', str(e)[:80], 0)
        print(n, res[n], flush=True)
    json.dump(res, open(os.path.join(out, '_report.json'), 'w'), ensure_ascii=False, indent=1)
