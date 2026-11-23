# G9 comparison report

Rounds 1-7 (stylised base, previous agent) are history: previews/compare/round1..7_*.png.
From round 8 on: G9 protocol (plan section 5 + 11). g = |ours - target| / tol.

## Round 8: baseline (stylised base after the first face rework)

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 7.686 | 8.2 | 2.57 | 7.501 | 8.0 | 2.49 | 3 |
| shoulder_w_over_head_h | 1.745 | 1.5 | 3.06 | 2.255 | 2.05 | 2.56 | 2 |
| waist_w_over_head_h | 0.712 | 0.86 | 2.47 | 1.014 | 1.15 | 2.27 | 2 |
| hip_w_over_head_h | 1.634 | 1.38 | 3.17 | 1.282 | 1.3 | 0.23 | 2 |
| waist_over_hip | 0.436 | 0.62 | 4.6 | 0.791 | 0.88 | 2.22 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.491 | 0.48 | 0.92 | 2 |
| neck_w_over_head_h | 0.39 | 0.35 | 1.33 | 0.562 | 0.5 | 2.07 | 1 |
| neck_len_over_head_h | 0.177 | 0.36 | 4.58 | 0.187 | 0.32 | 3.33 | 1 |
| hand_len_over_head_h | 0.818 | 0.76 | 1.16 | 0.886 | 0.8 | 1.72 | 2 |
| wrist_hang_vs_crotch | 0.032 | 0.0 | 2.13 | 0.034 | 0.0 | 2.27 | 1 |
| eye_w_over_head_h | 0.26 | 0.22 | 2.67 | 0.192 | 0.19 | 0.13 | 3 |
| eye_h_over_w | 0.438 | 0.38 | 1.45 | 0.507 | 0.36 | 3.68 | 3 |
| eye_tilt_deg | 4.134 | 9 | 1.62 | -3.727 | 5 | 2.91 | 2 |
| iris_d_over_eye_w | 0.394 | 0.45 | 1.4 | 0.49 | 0.45 | 1.0 | 2 |
| inter_over_eye_w | 0.634 | 0.7 | 0.82 | 0.646 | 0.8 | 1.93 | 1 |
| nose_w_over_face_w | 0.255 | 0.22 | 1.4 | 0.364 | 0.26 | 4.16 | 2 |
| nose_len_over_head_h | 0.208 | 0.22 | 0.48 | 0.194 | 0.23 | 1.44 | 1 |
| mouth_w_over_face_w | 0.247 | 0.46 | 7.1 | 0.337 | 0.46 | 4.1 | 3 |
| mouth_w_over_nose_w | 0.969 | >=1.8 | 8.31 | 0.926 | >=1.6 | 6.74 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.493 | 0.3 | 3.86 | 0.616 | 0.4 | 4.32 | 2 |
| ear_h_over_head_h | 0.289 | 0.2 | 4.45 | 0.336 | 0.21 | 6.3 | 3 |
| ear_stickout_over_head_w | 0.188 | 0.03 | 7.9 | 0.173 | 0.04 | 6.65 | 3 |
| eye_line_from_top | 0.523 | 0.52 | 0.1 | 0.513 | 0.51 | 0.1 | 1 |
| eyeball_d_over_eye_w | 0.985 | 1.12 | 2.25 | 1.226 | 1.12 | 1.77 | 1 |
| **weighted mean g (body/face rows)** | | | **3.274** | | | **2.985** | |

### Loomis rows, round 8

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.367 | 0.39 | 1.15 | 0.374 | 0.4 | 1.3 |
| eye_line | 0.523 | 0.53 | 0.47 | 0.513 | 0.52 | 0.47 |
| eye_between_brow_and_nose | 0.418 | 0.45 | 0.64 | 0.425 | 0.39 | 0.7 |
| nose_tip | 0.679 | 0.64 | 1.95 | 0.641 | 0.66 | 0.95 |
| nose_base | 0.739 | 0.7 | 2.6 | 0.702 | 0.71 | 0.53 |
| mouth_line | 0.825 | 0.81 | 1.0 | 0.782 | 0.81 | 1.87 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.701 | 0.97 | 4.48 | 0.91 | 0.94 | 0.5 |
| ear_top | 0.419 | 0.46 | 2.05 | 0.388 | 0.45 | 3.1 |
| ear_bottom | 0.708 | 0.66 | 2.4 | 0.724 | 0.66 | 3.2 |
| ear_h | 0.289 | 0.2 | 4.45 | 0.336 | 0.21 | 6.3 |
| ear_front_depth | 0.476 | 0.52 | 1.1 | 0.41 | 0.52 | 2.75 |
| ear_tilt_deg | 6.904 | 12 | 1.02 | 10.125 | 12 | 0.38 |
| head_w_over_h | 0.737 | 0.7 | 1.23 | 0.639 | 0.7 | 2.03 |
| head_depth_over_h | 0.909 | 0.86 | 1.63 | 1.013 | 0.88 | 4.43 |
| eye_w_over_head_w | 0.353 | 0.31 | 2.15 | 0.3 | 0.27 | 1.5 |
| gap_over_head_w | 0.224 | 0.22 | 0.16 | 0.194 | 0.22 | 1.04 |
| nose_w_over_head_w | 0.243 | 0.21 | 1.32 | 0.328 | 0.25 | 3.12 |
| mouth_w_over_head_w | 0.236 | 0.44 | 6.8 | 0.303 | 0.44 | 4.57 |
| mouth_w_over_pupil | 0.425 | 0.83 | 5.06 | 0.635 | 0.9 | 3.31 |
| **weighted mean g** | | | 2.418 | | | 2.358 |

## Round 9: WP2: rebased on the realistic scan bodies, proportioned (no stylise yet)

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.198 | 8.2 | 0.01 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.451 | 1.5 | 0.61 | 1.302 | 2.05 | 9.35 | 2 |
| waist_w_over_head_h | 1.141 | 0.86 | 4.68 | 1.338 | 1.15 | 3.13 | 2 |
| hip_w_over_head_h | 1.801 | 1.38 | 5.26 | 1.717 | 1.3 | 5.21 | 2 |
| waist_over_hip | 0.633 | 0.62 | 0.33 | 0.779 | 0.88 | 2.52 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.0 | 0.35 | 11.67 | 0.0 | 0.5 | 16.67 | 1 |
| neck_len_over_head_h | -0.403 | 0.36 | 19.07 | -0.432 | 0.32 | 18.8 | 1 |
| hand_len_over_head_h | 0.763 | 0.76 | 0.06 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.004 | 0.0 | 0.27 | 0.005 | 0.0 | 0.33 | 1 |
| eye_w_over_head_h | 0.116 | 0.22 | 6.93 | 0.111 | 0.19 | 5.27 | 3 |
| eye_h_over_w | 0.586 | 0.38 | 5.15 | 0.535 | 0.36 | 4.38 | 3 |
| eye_tilt_deg | 5.413 | 9 | 1.2 | 3.469 | 5 | 0.51 | 2 |
| iris_d_over_eye_w | 0.395 | 0.45 | 1.37 | 0.377 | 0.45 | 1.83 | 2 |
| inter_over_eye_w | 1.631 | 0.7 | 11.64 | 1.679 | 0.8 | 10.99 | 1 |
| nose_w_over_face_w | 0.573 | 0.22 | 14.12 | 0.616 | 0.26 | 14.24 | 2 |
| nose_len_over_head_h | 0.299 | 0.22 | 3.16 | 0.301 | 0.23 | 2.84 | 1 |
| mouth_w_over_face_w | 0.348 | 0.46 | 3.73 | 0.396 | 0.46 | 2.13 | 3 |
| mouth_w_over_nose_w | 0.607 | >=1.8 | 11.93 | 0.643 | >=1.6 | 9.57 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.811 | 0.3 | 10.22 | 0.902 | 0.4 | 10.04 | 2 |
| ear_h_over_head_h | 0.246 | 0.2 | 2.3 | 0.239 | 0.21 | 1.45 | 3 |
| ear_stickout_over_head_w | 0.068 | 0.03 | 1.9 | 0.079 | 0.04 | 1.95 | 3 |
| eye_line_from_top | 0.485 | 0.52 | 1.17 | 0.491 | 0.51 | 0.63 | 1 |
| eyeball_d_over_eye_w | 0.986 | 1.12 | 2.23 | 0.943 | 1.12 | 2.95 | 1 |
| **weighted mean g (body/face rows)** | | | **4.357** | | | **4.47** | |

### Loomis rows, round 9

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.351 | 0.39 | 1.95 | 0.387 | 0.4 | 0.65 |
| eye_line | 0.485 | 0.53 | 3.0 | 0.491 | 0.52 | 1.93 |
| eye_between_brow_and_nose | 0.307 | 0.45 | 2.86 | 0.256 | 0.39 | 2.68 |
| nose_tip | 0.786 | 0.64 | 7.3 | 0.789 | 0.66 | 6.45 |
| nose_base | 0.79 | 0.7 | 6.0 | 0.796 | 0.71 | 5.73 |
| mouth_line | 0.846 | 0.81 | 2.4 | 0.851 | 0.81 | 2.73 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.478 | 0.97 | 8.2 | 0.499 | 0.94 | 7.35 |
| ear_top | 0.483 | 0.46 | 1.15 | 0.458 | 0.45 | 0.4 |
| ear_bottom | 0.729 | 0.66 | 3.45 | 0.697 | 0.66 | 1.85 |
| ear_h | 0.246 | 0.2 | 2.3 | 0.239 | 0.21 | 1.45 |
| ear_front_depth | 0.499 | 0.52 | 0.53 | 0.498 | 0.52 | 0.55 |
| ear_tilt_deg | 15.855 | 12 | 0.77 | 9.848 | 12 | 0.43 |
| head_w_over_h | 0.701 | 0.7 | 0.03 | 0.689 | 0.7 | 0.37 |
| head_depth_over_h | 0.97 | 0.86 | 3.67 | 0.963 | 0.88 | 2.77 |
| eye_w_over_head_w | 0.165 | 0.31 | 7.25 | 0.161 | 0.27 | 5.45 |
| gap_over_head_w | 0.27 | 0.22 | 2.0 | 0.271 | 0.22 | 2.04 |
| nose_w_over_head_w | 0.493 | 0.21 | 11.32 | 0.514 | 0.25 | 10.56 |
| mouth_w_over_head_w | 0.299 | 0.44 | 4.7 | 0.331 | 0.44 | 3.63 |
| mouth_w_over_pupil | 0.691 | 0.83 | 1.74 | 0.767 | 0.9 | 1.66 |
| **weighted mean g** | | | 3.927 | | | 3.254 |

## Round 10: WP3 stylise pass, first full run

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.199 | 8.2 | 0.0 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.562 | 1.5 | 0.78 | 1.987 | 2.05 | 0.79 | 2 |
| waist_w_over_head_h | 0.873 | 0.86 | 0.22 | 1.146 | 1.15 | 0.07 | 2 |
| hip_w_over_head_h | 1.383 | 1.38 | 0.04 | 1.3 | 1.3 | 0.0 | 2 |
| waist_over_hip | 0.631 | 0.62 | 0.28 | 0.882 | 0.88 | 0.05 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.636 | 0.5 | 4.53 | 1 |
| neck_len_over_head_h | 0.36 | 0.36 | 0.0 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.763 | 0.76 | 0.06 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.004 | 0.0 | 0.27 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.203 | 0.22 | 1.13 | 0.181 | 0.19 | 0.6 | 3 |
| eye_h_over_w | 0.761 | 0.38 | 9.53 | 0.839 | 0.36 | 11.97 | 3 |
| eye_tilt_deg | 5.62 | 9 | 1.13 | -4.389 | 5 | 3.13 | 2 |
| iris_d_over_eye_w | 0.382 | 0.45 | 1.7 | 0.392 | 0.45 | 1.45 | 2 |
| inter_over_eye_w | 0.822 | 0.7 | 1.52 | 0.891 | 0.8 | 1.14 | 1 |
| nose_w_over_face_w | 0.372 | 0.22 | 6.08 | 0.321 | 0.26 | 2.44 | 2 |
| nose_len_over_head_h | 0.219 | 0.22 | 0.04 | 0.246 | 0.23 | 0.64 | 1 |
| mouth_w_over_face_w | 0.242 | 0.46 | 7.27 | 0.302 | 0.46 | 5.27 | 3 |
| mouth_w_over_nose_w | 0.65 | >=1.8 | 11.5 | 0.942 | >=1.6 | 6.58 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.787 | 0.3 | 9.74 | 0.9 | 0.4 | 10.0 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.04 | 0.04 | 0.0 | 3 |
| eye_line_from_top | 0.512 | 0.52 | 0.27 | 0.516 | 0.51 | 0.2 | 1 |
| eyeball_d_over_eye_w | 0.956 | 1.12 | 2.73 | 0.98 | 1.12 | 2.33 | 1 |
| **weighted mean g (body/face rows)** | | | **2.635** | | | **2.354** | |

### Loomis rows, round 10

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.418 | 0.39 | 1.4 | 0.419 | 0.4 | 0.95 |
| eye_line | 0.512 | 0.53 | 1.2 | 0.516 | 0.52 | 0.27 |
| eye_between_brow_and_nose | 0.292 | 0.45 | 3.16 | 0.289 | 0.39 | 2.02 |
| nose_tip | 0.7 | 0.64 | 3.0 | 0.703 | 0.66 | 2.15 |
| nose_base | 0.741 | 0.7 | 2.73 | 0.755 | 0.71 | 3.0 |
| mouth_line | 0.84 | 0.81 | 2.0 | 0.835 | 0.81 | 1.67 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.8 | 0.97 | 2.83 | 0.727 | 0.94 | 3.55 |
| ear_top | 0.461 | 0.46 | 0.05 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.511 | 0.52 | 0.23 | 0.486 | 0.52 | 0.85 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.702 | 0.7 | 0.07 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.863 | 0.86 | 0.1 | 0.91 | 0.88 | 1.0 |
| eye_w_over_head_w | 0.289 | 0.31 | 1.05 | 0.26 | 0.27 | 0.5 |
| gap_over_head_w | 0.237 | 0.22 | 0.68 | 0.231 | 0.22 | 0.44 |
| nose_w_over_head_w | 0.33 | 0.21 | 4.8 | 0.273 | 0.25 | 0.92 |
| mouth_w_over_head_w | 0.215 | 0.44 | 7.5 | 0.258 | 0.44 | 6.07 |
| mouth_w_over_pupil | 0.41 | 0.83 | 5.25 | 0.525 | 0.9 | 4.69 |
| **weighted mean g** | | | 1.969 | | | 1.611 |

## Round 11: WP3 stylise: radial eye map, Loomis layout last, fixed measurements

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.197 | 8.2 | 0.02 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.561 | 1.5 | 0.76 | 1.987 | 2.05 | 0.79 | 2 |
| waist_w_over_head_h | 0.873 | 0.86 | 0.22 | 1.146 | 1.15 | 0.07 | 2 |
| hip_w_over_head_h | 1.383 | 1.38 | 0.04 | 1.3 | 1.3 | 0.0 | 2 |
| waist_over_hip | 0.631 | 0.62 | 0.28 | 0.882 | 0.88 | 0.05 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.636 | 0.5 | 4.53 | 1 |
| neck_len_over_head_h | 0.36 | 0.36 | 0.0 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.763 | 0.76 | 0.06 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.004 | 0.0 | 0.27 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.199 | 0.22 | 1.4 | 0.178 | 0.19 | 0.8 | 3 |
| eye_h_over_w | 0.858 | 0.38 | 11.95 | 0.973 | 0.36 | 15.32 | 3 |
| eye_tilt_deg | 10.563 | 9 | 0.52 | -0.705 | 5 | 1.9 | 2 |
| iris_d_over_eye_w | 0.393 | 0.45 | 1.42 | 0.404 | 0.45 | 1.15 | 2 |
| inter_over_eye_w | 0.792 | 0.7 | 1.15 | 0.863 | 0.8 | 0.79 | 1 |
| nose_w_over_face_w | 0.414 | 0.22 | 7.76 | 0.44 | 0.26 | 7.2 | 2 |
| nose_len_over_head_h | 0.168 | 0.22 | 2.08 | 0.19 | 0.23 | 1.6 | 1 |
| mouth_w_over_face_w | 0.419 | 0.46 | 1.37 | 0.44 | 0.46 | 0.67 | 3 |
| mouth_w_over_nose_w | 1.012 | >=1.8 | 7.88 | 1.0 | >=1.6 | 6.0 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.771 | 0.3 | 9.42 | 0.9 | 0.4 | 10.0 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.04 | 0.04 | 0.0 | 3 |
| eye_line_from_top | 0.516 | 0.52 | 0.13 | 0.519 | 0.51 | 0.3 | 1 |
| eyeball_d_over_eye_w | 0.983 | 1.12 | 2.28 | 1.009 | 1.12 | 1.85 | 1 |
| **weighted mean g (body/face rows)** | | | **2.326** | | | **2.403** | |

### Loomis rows, round 11

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.409 | 0.39 | 0.95 | 0.399 | 0.4 | 0.05 |
| eye_line | 0.516 | 0.53 | 0.93 | 0.519 | 0.52 | 0.07 |
| eye_between_brow_and_nose | 0.365 | 0.45 | 1.7 | 0.389 | 0.39 | 0.02 |
| nose_tip | 0.7 | 0.64 | 3.0 | 0.703 | 0.66 | 2.15 |
| nose_base | 0.702 | 0.7 | 0.13 | 0.707 | 0.71 | 0.2 |
| mouth_line | 0.854 | 0.81 | 2.93 | 0.846 | 0.81 | 2.4 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 1.017 | 0.97 | 0.78 | 0.947 | 0.94 | 0.12 |
| ear_top | 0.461 | 0.46 | 0.05 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.511 | 0.52 | 0.23 | 0.486 | 0.52 | 0.85 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.702 | 0.7 | 0.07 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.862 | 0.86 | 0.07 | 0.91 | 0.88 | 1.0 |
| eye_w_over_head_w | 0.284 | 0.31 | 1.3 | 0.255 | 0.27 | 0.75 |
| gap_over_head_w | 0.225 | 0.22 | 0.2 | 0.22 | 0.22 | 0.0 |
| nose_w_over_head_w | 0.376 | 0.21 | 6.64 | 0.375 | 0.25 | 5.0 |
| mouth_w_over_head_w | 0.38 | 0.44 | 2.0 | 0.375 | 0.44 | 2.17 |
| mouth_w_over_pupil | 0.755 | 0.83 | 0.94 | 0.79 | 0.9 | 1.37 |
| **weighted mean g** | | | 1.162 | | | 0.901 |

## Round 12: WP3: lid thickness kept, smooth Loomis z map, wider mouth zone

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.198 | 8.2 | 0.01 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.561 | 1.5 | 0.76 | 1.987 | 2.05 | 0.79 | 2 |
| waist_w_over_head_h | 0.873 | 0.86 | 0.22 | 1.146 | 1.15 | 0.07 | 2 |
| hip_w_over_head_h | 1.383 | 1.38 | 0.04 | 1.3 | 1.3 | 0.0 | 2 |
| waist_over_hip | 0.631 | 0.62 | 0.28 | 0.882 | 0.88 | 0.05 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.636 | 0.5 | 4.53 | 1 |
| neck_len_over_head_h | 0.36 | 0.36 | 0.0 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.763 | 0.76 | 0.06 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.004 | 0.0 | 0.27 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.207 | 0.22 | 0.87 | 0.183 | 0.19 | 0.47 | 3 |
| eye_h_over_w | 0.614 | 0.38 | 5.85 | 0.773 | 0.36 | 10.33 | 3 |
| eye_tilt_deg | 8.44 | 9 | 0.19 | -2.892 | 5 | 2.63 | 2 |
| iris_d_over_eye_w | 0.378 | 0.45 | 1.8 | 0.391 | 0.45 | 1.47 | 2 |
| inter_over_eye_w | 0.817 | 0.7 | 1.46 | 0.866 | 0.8 | 0.82 | 1 |
| nose_w_over_face_w | 0.423 | 0.22 | 8.12 | 0.44 | 0.26 | 7.2 | 2 |
| nose_len_over_head_h | 0.167 | 0.22 | 2.12 | 0.189 | 0.23 | 1.64 | 1 |
| mouth_w_over_face_w | 0.428 | 0.46 | 1.07 | 0.44 | 0.46 | 0.67 | 3 |
| mouth_w_over_nose_w | 1.012 | >=1.8 | 7.88 | 1.0 | >=1.6 | 6.0 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.787 | 0.3 | 9.74 | 0.9 | 0.4 | 10.0 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.04 | 0.04 | 0.0 | 3 |
| eye_line_from_top | 0.52 | 0.52 | 0.0 | 0.523 | 0.51 | 0.43 | 1 |
| eyeball_d_over_eye_w | 0.944 | 1.12 | 2.93 | 0.978 | 1.12 | 2.37 | 1 |
| **weighted mean g (body/face rows)** | | | **1.941** | | | **2.129** | |

### Loomis rows, round 12

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.368 | 0.39 | 1.1 | 0.399 | 0.4 | 0.05 |
| eye_line | 0.52 | 0.53 | 0.67 | 0.523 | 0.52 | 0.2 |
| eye_between_brow_and_nose | 0.453 | 0.45 | 0.06 | 0.402 | 0.39 | 0.24 |
| nose_tip | 0.697 | 0.64 | 2.85 | 0.699 | 0.66 | 1.95 |
| nose_base | 0.702 | 0.7 | 0.13 | 0.707 | 0.71 | 0.2 |
| mouth_line | 0.868 | 0.81 | 3.87 | 0.858 | 0.81 | 3.2 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.893 | 0.97 | 1.28 | 0.947 | 0.94 | 0.12 |
| ear_top | 0.461 | 0.46 | 0.05 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.511 | 0.52 | 0.23 | 0.486 | 0.52 | 0.85 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.702 | 0.7 | 0.07 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.863 | 0.86 | 0.1 | 0.91 | 0.88 | 1.0 |
| eye_w_over_head_w | 0.295 | 0.31 | 0.75 | 0.263 | 0.27 | 0.35 |
| gap_over_head_w | 0.241 | 0.22 | 0.84 | 0.228 | 0.22 | 0.32 |
| nose_w_over_head_w | 0.376 | 0.21 | 6.64 | 0.375 | 0.25 | 5.0 |
| mouth_w_over_head_w | 0.38 | 0.44 | 2.0 | 0.375 | 0.44 | 2.17 |
| mouth_w_over_pupil | 0.714 | 0.83 | 1.45 | 0.766 | 0.9 | 1.68 |
| **weighted mean g** | | | 1.217 | | | 0.968 |

## Status after round 12 (2026-11-16): WP0, WP1, WP2 done; WP3 in progress; stopped at Gate 1

Packages
- WP0 done: `legacy_stylised/` (scripts + JSON, pre-G9 FBX set in `export_fbx/`, Unity `People/` backup kept OUTSIDE the Unity
  project in `unity_People_pre_g9/`, nothing under `unity/` written); `source/human_base_realistic.blend` (30.6 MB, the 15 objects);
  `CREDITS.md` entry.
- WP1 done: `measure.py` (planner definitions, dense slices), `compare_targets.json` (5.3 + 11.4 rows), `compare.py` (render set,
  composites, eye-aligned overlay, scores), `loomis_overlay.py` + `loomis_draw.py` (11.5), `tools/unity_shots/` (SHOTS_DIR).
  Baseline round 8 equals `plan/ours_3d_measure.json` within 0.01 (acceptance met).
- WP2 done (round 9): realistic male/female scans, symmetrised (mirror map, max partner distance 4.2 mm), lip slit cut along
  the face-set 8/22 border, warp to 8.2 / 8.0 heads, crotch 0.485 / 0.480, arms so the wrist hangs at the crotch, hands 0.76 /
  0.80 head. Tris: head 6,132, nose 374, ears 447 each, torso 2,000, arms 1,588, hands 2,554, legs 2,428, feet 1,412 (within 2.7).
  Acceptance numbers: heads 8.198 / 7.972, crotch 0.485 / 0.480, waist/hip 0.633 / 0.779, all inside.
- WP3 in progress (rounds 10-12): `stylise.py` (skull, eyes with a monotone radial map, nose, mouth, chin, ears, Loomis layout
  with a monotone cubic z map, neck, body widths, smoothing). Donor transfer (`transfer.py`, Generic-head toon directions,
  Planar blend) NOT started.

Round 12 key rows (F / M; target in brackets)
| row | F | M | target F / M |
|---|---|---|---|
| heads_tall | 8.20 | 7.97 | 8.2 / 8.0 |
| waist / hip | 0.631 | 0.882 | 0.62 / 0.88 |
| shoulder, waist, hip (head heights) | 1.56, 0.87, 1.38 | 1.99, 1.15, 1.30 | 1.50, 0.86, 1.38 / 2.05, 1.15, 1.30 |
| eye width / head height | 0.207 | 0.183 | 0.22 / 0.19 |
| eye height / width | 0.61 | 0.77 | 0.38 / 0.36 (fail) |
| ear height / head, stick-out / head width | 0.201, 0.030 | 0.209, 0.040 | 0.20, 0.03 / 0.21, 0.04 (pass) |
| mouth width / face width | 0.43 | 0.44 | 0.46 |
| Loomis brow, eye, nose base, mouth line | 0.368, 0.520, 0.702, 0.868 | 0.399, 0.523, 0.707, 0.858 | 0.39, 0.53, 0.70, 0.81 |
| weighted mean g body/face rows | 1.94 | 2.13 | <= 0.6 |
| weighted mean g Loomis rows | 1.22 | 0.97 | <= 0.6 |

Centimetre table for Gate 1 (stylise log, neutral rest pose): feminine shoulders 33.6 -> 30.3 cm, waist 22.8 -> 17.4 cm,
hips 36.2 -> 27.9 cm; masculine shoulders 38.3 -> 44.8, waist 29.4 -> 25.2, hips 37.7 -> 28.4 (head 20.2 / 21.9 cm). In the
renders the feminine body reads too thin next to the clothed reference: a Gate-1 question (plan 5.7), not changed silently.

Known open problems (next WP3 rounds)
1. Mouth: the scan's 8/22 border is U-shaped (ends near the nose base, middle at the lip junction), so "corners = border ends"
   is wrong: mouth line measures 0.868 while the stylise pass aims its mean at 0.81, a crease shows under the nose and the
   widening zone is centred too high. Fix: take the true commissures (lateral-most points of the lip junction at the midline
   height) and cut/align on those.
2. Eyes: aperture too round (h/w 0.61 / 0.77): the radial map keeps the scan's aperture shape; needs a vertical squash of the
   lid margins and an almond shape, then the eyeball (WP4: 0.56 x aperture).
3. Chin and nose width rows use set extents that include cheek/lip skin on the scan; their g values are not yet meaningful.
4. Skin texture masks (lips, lash line) still follow the stylised layout: lip colour is misplaced (WP7).
5. Exports in `export/` and `parts/export/` are still the pre-G9 build: do not import into Unity until WP9.

## Round 13: Gate 1 changes: wider body, 1.65/1.78 m, narrower almond eyes with heavy lids and crease, solid lashes, longer bridge, true mouth corners, placeholder hair

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.203 | 8.2 | 0.02 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.636 | 1.62 | 0.2 | 2.0 | 2.05 | 0.62 | 2 |
| waist_w_over_head_h | 1.012 | 1.0 | 0.2 | 1.248 | 1.25 | 0.03 | 2 |
| hip_w_over_head_h | 1.505 | 1.5 | 0.06 | 1.42 | 1.42 | 0.0 | 2 |
| waist_over_hip | 0.672 | 0.667 | 0.13 | 0.879 | 0.88 | 0.03 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.644 | 0.5 | 4.8 | 1 |
| neck_len_over_head_h | 0.361 | 0.36 | 0.03 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.764 | 0.76 | 0.08 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.005 | 0.0 | 0.33 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.169 | 0.182 | 0.87 | 0.164 | 0.168 | 0.27 | 3 |
| eye_h_over_w | 0.664 | 0.38 | 7.1 | 0.652 | 0.36 | 7.3 | 3 |
| eye_tilt_deg | -1.915 | 9 | 3.64 | -13.319 | 5 | 6.11 | 2 |
| iris_d_over_eye_w | 0.417 | 0.45 | 0.83 | 0.387 | 0.45 | 1.57 | 2 |
| inter_over_eye_w | 1.183 | 1.0 | 2.29 | 1.105 | 1.0 | 1.31 | 1 |
| nose_w_over_face_w | 0.401 | 0.22 | 7.24 | 0.417 | 0.26 | 6.28 | 2 |
| nose_len_over_head_h | 0.198 | 0.22 | 0.88 | 0.218 | 0.23 | 0.48 | 1 |
| mouth_w_over_face_w | 0.428 | 0.46 | 1.07 | 0.441 | 0.46 | 0.63 | 3 |
| mouth_w_over_nose_w | 1.069 | >=1.8 | 7.31 | 1.059 | >=1.6 | 5.41 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.787 | 0.3 | 9.74 | 0.884 | 0.4 | 9.68 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.039 | 0.04 | 0.05 | 3 |
| eye_line_from_top | 0.507 | 0.52 | 0.43 | 0.508 | 0.51 | 0.07 | 1 |
| eyeball_d_over_eye_w | 1.044 | 1.12 | 1.27 | 0.968 | 1.12 | 2.53 | 1 |
| **weighted mean g (body/face rows)** | | | **1.998** | | | **1.979** | |

### Loomis rows, round 13

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.367 | 0.39 | 1.15 | 0.399 | 0.4 | 0.05 |
| eye_line | 0.507 | 0.53 | 1.53 | 0.508 | 0.52 | 0.8 |
| eye_between_brow_and_nose | 0.418 | 0.45 | 0.64 | 0.356 | 0.39 | 0.68 |
| nose_tip | 0.699 | 0.64 | 2.95 | 0.701 | 0.66 | 2.05 |
| nose_base | 0.703 | 0.7 | 0.2 | 0.707 | 0.71 | 0.2 |
| mouth_line | 0.811 | 0.81 | 0.07 | 0.805 | 0.81 | 0.33 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.888 | 0.97 | 1.37 | 0.947 | 0.94 | 0.12 |
| ear_top | 0.462 | 0.46 | 0.1 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.519 | 0.52 | 0.03 | 0.49 | 0.52 | 0.75 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.703 | 0.7 | 0.1 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.878 | 0.86 | 0.6 | 0.931 | 0.88 | 1.7 |
| eye_w_over_head_w | 0.24 | 0.26 | 1.0 | 0.235 | 0.24 | 0.25 |
| gap_over_head_w | 0.284 | 0.26 | 0.96 | 0.259 | 0.24 | 0.76 |
| nose_w_over_head_w | 0.356 | 0.21 | 5.84 | 0.355 | 0.25 | 4.2 |
| mouth_w_over_head_w | 0.38 | 0.44 | 2.0 | 0.376 | 0.44 | 2.13 |
| mouth_w_over_pupil | 0.726 | 0.85 | 1.55 | 0.772 | 0.85 | 0.97 |
| **weighted mean g** | | | 1.02 | | | 0.782 |

## Round 14: scan mouth: slit only on the visible lip junction, no flattening; lighter rest lids

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.203 | 8.2 | 0.02 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.636 | 1.62 | 0.2 | 2.0 | 2.05 | 0.62 | 2 |
| waist_w_over_head_h | 1.012 | 1.0 | 0.2 | 1.248 | 1.25 | 0.03 | 2 |
| hip_w_over_head_h | 1.505 | 1.5 | 0.06 | 1.42 | 1.42 | 0.0 | 2 |
| waist_over_hip | 0.672 | 0.667 | 0.13 | 0.879 | 0.88 | 0.03 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.644 | 0.5 | 4.8 | 1 |
| neck_len_over_head_h | 0.361 | 0.36 | 0.03 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.764 | 0.76 | 0.08 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.005 | 0.0 | 0.33 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.159 | 0.182 | 1.53 | 0.152 | 0.168 | 1.07 | 3 |
| eye_h_over_w | 0.757 | 0.38 | 9.43 | 0.771 | 0.36 | 10.28 | 3 |
| eye_tilt_deg | 11.709 | 9 | 0.9 | 2.595 | 5 | 0.8 | 2 |
| iris_d_over_eye_w | 0.443 | 0.45 | 0.18 | 0.416 | 0.45 | 0.85 | 2 |
| inter_over_eye_w | 1.255 | 1.0 | 3.19 | 1.154 | 1.0 | 1.92 | 1 |
| nose_w_over_face_w | 0.441 | 0.22 | 8.84 | 0.432 | 0.26 | 6.88 | 2 |
| nose_len_over_head_h | 0.16 | 0.22 | 2.4 | 0.179 | 0.23 | 2.04 | 1 |
| mouth_w_over_face_w | 0.43 | 0.46 | 1.0 | 0.442 | 0.46 | 0.6 | 3 |
| mouth_w_over_nose_w | 0.975 | >=1.8 | 8.25 | 1.022 | >=1.6 | 5.78 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.787 | 0.3 | 9.74 | 0.884 | 0.4 | 9.68 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.039 | 0.04 | 0.05 | 3 |
| eye_line_from_top | 0.526 | 0.52 | 0.2 | 0.525 | 0.51 | 0.5 | 1 |
| eyeball_d_over_eye_w | 1.108 | 1.12 | 0.2 | 1.041 | 1.12 | 1.32 | 1 |
| **weighted mean g (body/face rows)** | | | **2.169** | | | **2.031** | |

### Loomis rows, round 14

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.391 | 0.39 | 0.05 | 0.399 | 0.4 | 0.05 |
| eye_line | 0.526 | 0.53 | 0.27 | 0.525 | 0.52 | 0.33 |
| eye_between_brow_and_nose | 0.432 | 0.45 | 0.36 | 0.408 | 0.39 | 0.36 |
| nose_tip | 0.699 | 0.64 | 2.95 | 0.701 | 0.66 | 2.05 |
| nose_base | 0.703 | 0.7 | 0.2 | 0.707 | 0.71 | 0.2 |
| mouth_line | 0.813 | 0.81 | 0.2 | 0.807 | 0.81 | 0.2 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 0.956 | 0.97 | 0.23 | 0.947 | 0.94 | 0.12 |
| ear_top | 0.462 | 0.46 | 0.1 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.519 | 0.52 | 0.03 | 0.49 | 0.52 | 0.75 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.703 | 0.7 | 0.1 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.878 | 0.86 | 0.6 | 0.931 | 0.88 | 1.7 |
| eye_w_over_head_w | 0.226 | 0.26 | 1.7 | 0.218 | 0.24 | 1.1 |
| gap_over_head_w | 0.284 | 0.26 | 0.96 | 0.252 | 0.24 | 0.48 |
| nose_w_over_head_w | 0.392 | 0.21 | 7.28 | 0.368 | 0.25 | 4.72 |
| mouth_w_over_head_w | 0.382 | 0.44 | 1.93 | 0.376 | 0.44 | 2.13 |
| mouth_w_over_pupil | 0.756 | 0.85 | 1.17 | 0.801 | 0.85 | 0.61 |
| **weighted mean g** | | | 0.877 | | | 0.782 |

## Round 15: soft nose mask (no crease under the nose), eyeball set back less

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.203 | 8.2 | 0.02 | 7.972 | 8.0 | 0.14 | 3 |
| shoulder_w_over_head_h | 1.636 | 1.62 | 0.2 | 2.0 | 2.05 | 0.62 | 2 |
| waist_w_over_head_h | 1.012 | 1.0 | 0.2 | 1.248 | 1.25 | 0.03 | 2 |
| hip_w_over_head_h | 1.505 | 1.5 | 0.06 | 1.42 | 1.42 | 0.0 | 2 |
| waist_over_hip | 0.672 | 0.667 | 0.13 | 0.879 | 0.88 | 0.03 | 3 |
| crotch_over_height | 0.483 | 0.485 | 0.17 | 0.479 | 0.48 | 0.08 | 2 |
| neck_w_over_head_h | 0.471 | 0.35 | 4.03 | 0.644 | 0.5 | 4.8 | 1 |
| neck_len_over_head_h | 0.361 | 0.36 | 0.03 | 0.315 | 0.32 | 0.13 | 1 |
| hand_len_over_head_h | 0.764 | 0.76 | 0.08 | 0.798 | 0.8 | 0.04 | 2 |
| wrist_hang_vs_crotch | 0.005 | 0.0 | 0.33 | 0.009 | 0.0 | 0.6 | 1 |
| eye_w_over_head_h | 0.175 | 0.182 | 0.47 | 0.164 | 0.168 | 0.27 | 3 |
| eye_h_over_w | 0.7 | 0.38 | 8.0 | 0.729 | 0.36 | 9.22 | 3 |
| eye_tilt_deg | 7.533 | 9 | 0.49 | -3.134 | 5 | 2.71 | 2 |
| iris_d_over_eye_w | 0.403 | 0.45 | 1.17 | 0.387 | 0.45 | 1.57 | 2 |
| inter_over_eye_w | 1.104 | 1.0 | 1.3 | 1.058 | 1.0 | 0.73 | 1 |
| nose_w_over_face_w | 0.384 | 0.22 | 6.56 | 0.361 | 0.26 | 4.04 | 2 |
| nose_len_over_head_h | 0.165 | 0.22 | 2.2 | 0.188 | 0.23 | 1.68 | 1 |
| mouth_w_over_face_w | 0.427 | 0.46 | 1.1 | 0.452 | 0.46 | 0.27 | 3 |
| mouth_w_over_nose_w | 1.112 | >=1.8 | 6.88 | 1.25 | >=1.6 | 3.5 | 2 |
| lip_h_over_mouth_w | None | 0.3 | - | None | 0.25 | - | 3 |
| lip_h_over_head_h | None | 0.097 | - | None | 0.08 | - | 2 |
| chin_w_over_face_w | 0.787 | 0.3 | 9.74 | 0.906 | 0.4 | 10.12 | 2 |
| ear_h_over_head_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.039 | 0.04 | 0.05 | 3 |
| eye_line_from_top | 0.526 | 0.52 | 0.2 | 0.524 | 0.51 | 0.47 | 1 |
| eyeball_d_over_eye_w | 1.008 | 1.12 | 1.87 | 0.969 | 1.12 | 2.52 | 1 |
| **weighted mean g (body/face rows)** | | | **1.883** | | | **1.801** | |

### Loomis rows, round 15

| row | ours F | target | g | ours M | target | g |
|---|---|---|---|---|---|---|
| brow_line | 0.41 | 0.39 | 1.0 | 0.399 | 0.4 | 0.05 |
| eye_line | 0.526 | 0.53 | 0.27 | 0.524 | 0.52 | 0.27 |
| eye_between_brow_and_nose | 0.395 | 0.45 | 1.1 | 0.407 | 0.39 | 0.34 |
| nose_tip | 0.699 | 0.64 | 2.95 | 0.701 | 0.66 | 2.05 |
| nose_base | 0.703 | 0.7 | 0.2 | 0.707 | 0.71 | 0.2 |
| mouth_line | 0.813 | 0.81 | 0.2 | 0.807 | 0.81 | 0.2 |
| lip_top | None | 0.769 | - | None | 0.776 | - |
| lip_bottom | None | 0.866 | - | None | 0.856 | - |
| lower_over_middle_third | 1.017 | 0.97 | 0.78 | 0.947 | 0.94 | 0.12 |
| ear_top | 0.462 | 0.46 | 0.1 | 0.448 | 0.45 | 0.1 |
| ear_bottom | 0.662 | 0.66 | 0.1 | 0.658 | 0.66 | 0.1 |
| ear_h | 0.201 | 0.2 | 0.05 | 0.209 | 0.21 | 0.05 |
| ear_front_depth | 0.519 | 0.52 | 0.03 | 0.49 | 0.52 | 0.75 |
| ear_tilt_deg | 12.929 | 12 | 0.19 | 8.38 | 12 | 0.72 |
| head_w_over_h | 0.703 | 0.7 | 0.1 | 0.698 | 0.7 | 0.07 |
| head_depth_over_h | 0.878 | 0.86 | 0.6 | 0.931 | 0.88 | 1.7 |
| eye_w_over_head_w | 0.249 | 0.26 | 0.55 | 0.234 | 0.24 | 0.3 |
| gap_over_head_w | 0.275 | 0.26 | 0.6 | 0.248 | 0.24 | 0.32 |
| nose_w_over_head_w | 0.341 | 0.21 | 5.24 | 0.3 | 0.25 | 2.0 |
| mouth_w_over_head_w | 0.379 | 0.44 | 2.03 | 0.375 | 0.44 | 2.17 |
| mouth_w_over_pupil | 0.729 | 0.85 | 1.51 | 0.78 | 0.85 | 0.87 |
| **weighted mean g** | | | 0.83 | | | 0.602 |

## Gate 1 answers applied, rounds 13-15 (2026-11-17)
User Gate 1 (round 12): keep more width; women shorter than men; eyes ugly; nose too short; creepy; ears better. Then: eyes too wide.
Applied:
- heights 1.65 m (F) / 1.78 m (M), heads-tall kept (8.2 / 8.0); species presets scale from these (`species.F_OVER_M`).
- body widths: F shoulders 1.62, waist 1.00, hips 1.50 head heights (32.7 / 20.2 / 30.3 cm); M 2.05 / 1.25 / 1.42
  (45.6 / 27.8 / 31.6 cm); `compare_targets.json` updated (`_gate1`).
- eyes: width 0.26 F / 0.24 M of head width (0.182 / 0.168 head heights), one eye width between the eyes (`_gate1b`);
  heavy rest lids, upper-lid crease field, solid lash mass with an outer wing flick, alpha only at the tips.
- nose: longer, slimmer bridge from the brows, tip lowered; mouth: slit only along the visible lip junction (true corners).
- comparison renders: placeholder hair mass on the face shots; new `round<N>_features.png` = reference eye / nose / mouth /
  face crops over ours, cut from our render warped onto the reference frame by the eye centres.

Round 15 (latest): weighted mean g body/face F 1.88 / M 1.80, Loomis F 0.83 / M 0.60. Lines: F brow 0.39, eye 0.53,
nose base 0.70, mouth 0.81 (on target). Ears pass. NOT acceptable yet, by inspection:
1. A horizontal ledge under the nose: the Loomis z-map stretches the philtrum (nose base moved from 0.79 up to 0.70 while the
   mouth stays at 0.81) on the front of the face only; it needs the whole lower face, cheeks included, to move together.
2. Eyes are still far from the reference: the scan's lids scaled about the eyeball read as small dark slits in 3/4, no clear
   iris under a lid, no liner shape. The radial field approach is not enough; the eye region needs either donor geometry
   (`Head - Generic Topology` Toon_FEMALE, via the plan's transfer.py, not started) or a modelled lid template.
3. Lip colour comes from the analytic mask in skin_tex.py, not from the scan's lip geometry (WP7).
Recommendation: continue WP3 in a fresh session with the harness as is; implement transfer.py and take the eye and mouth
regions from the toon donor instead of more landmark fields.

## MakeHuman base (2026-11-17)

The scan-based base of rounds 8-15 is replaced by a MakeHuman base (MPFB 2.0.18 + MakeHuman system assets, CC0), built by
`art3d/characters/mh/` (see `mh/README.md`). Same stage, poses, cameras, targets (`compare_targets.json`) and composites; the
measurements are the same definitions on the hm08 topology (`mh/measure_mh.py`; eye width/height = the visible opening seen
from the front, by ray casting onto the eyeball). Images: `previews/compare/mh/`.

### MakeHuman base, round 1: MakeHuman neutral, first recipe (MH eye/nose/mouth/ear targets, eye scale field, proportion warp), MakeHuman proxies as shipped

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.888 | 1.62 | 3.35 | 2.147 | 2.05 | 1.21 | 2 |
| waist_w_over_head_h | 1.141 | 1.0 | 2.35 | 1.192 | 1.25 | 0.97 | 2 |
| hip_w_over_head_h | 1.823 | 1.5 | 4.04 | 1.819 | 1.42 | 4.99 | 2 |
| waist_over_hip | 0.626 | 0.667 | 1.03 | 0.655 | 0.88 | 5.62 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.445 | 0.35 | 3.17 | 0.649 | 0.5 | 4.97 | 1 |
| neck_len_over_head_h | 0.556 | 0.36 | 4.9 | 0.426 | 0.32 | 2.65 | 1 |
| hand_len_over_head_h | 0.806 | 0.76 | 0.92 | 0.984 | 0.8 | 3.68 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | 0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.153 | 0.182 | 1.93 | 0.134 | 0.168 | 2.27 | 3 |
| eye_h_over_w | 0.312 | 0.38 | 1.7 | 0.267 | 0.36 | 2.32 | 3 |
| eye_tilt_deg | 5.918 | 9 | 1.03 | 3.75 | 5 | 0.42 | 2 |
| iris_d_over_eye_w | 0.535 | 0.45 | 2.13 | 0.552 | 0.45 | 2.55 | 2 |
| inter_over_eye_w | 0.89 | 1.0 | 1.37 | 1.115 | 1.0 | 1.44 | 1 |
| nose_w_over_face_w | 0.297 | 0.22 | 3.08 | 0.291 | 0.26 | 1.24 | 2 |
| nose_len_over_head_h | 0.161 | 0.22 | 2.36 | 0.255 | 0.23 | 1.0 | 1 |
| mouth_w_over_face_w | 0.465 | 0.46 | 0.17 | 0.466 | 0.46 | 0.2 | 3 |
| mouth_w_over_nose_w | 1.566 | >=1.8 | 2.34 | 1.601 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.413 | 0.3 | 2.82 | 0.396 | 0.25 | 3.65 | 3 |
| lip_h_over_head_h | 0.11 | 0.097 | 1.08 | 0.102 | 0.08 | 1.83 | 2 |
| chin_w_over_face_w | 0.701 | 0.3 | 8.02 | 0.621 | 0.4 | 4.42 | 2 |
| ear_h_over_head_h | 0.205 | 0.2 | 0.25 | 0.214 | 0.21 | 0.2 | 3 |
| ear_stickout_over_head_w | 0.034 | 0.03 | 0.2 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.496 | 0.52 | 0.8 | 0.48 | 0.51 | 1.0 | 1 |
| eyeball_d_over_eye_w | 1.188 | 1.12 | 1.13 | 1.227 | 1.12 | 1.78 | 1 |
| **weighted mean g (body/face rows)** | | | **1.816** | | | **1.883** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.405 | 0.39 | 0.75 | 0.397 | 0.4 | 0.15 | 2 |
| eye_line | 0.496 | 0.53 | 2.27 | 0.48 | 0.52 | 2.67 | 3 |
| eye_between_brow_and_nose | 0.351 | 0.45 | 1.98 | 0.244 | 0.39 | 2.92 | 1 |
| nose_tip | 0.643 | 0.64 | 0.15 | 0.646 | 0.66 | 0.7 | 1 |
| nose_base | 0.665 | 0.7 | 2.33 | 0.74 | 0.71 | 2.0 | 3 |
| mouth_line | 0.78 | 0.81 | 2.0 | 0.779 | 0.81 | 2.07 | 3 |
| lip_top | 0.735 | 0.769 | 2.83 | 0.741 | 0.776 | 2.92 | 2 |
| lip_bottom | 0.845 | 0.866 | 1.75 | 0.843 | 0.856 | 1.08 | 2 |
| lower_over_middle_third | 1.287 | 0.97 | 5.28 | 0.757 | 0.94 | 3.05 | 3 |
| ear_top | 0.49 | 0.46 | 1.5 | 0.452 | 0.45 | 0.1 | 2 |
| ear_bottom | 0.695 | 0.66 | 1.75 | 0.666 | 0.66 | 0.3 | 2 |
| ear_h | 0.205 | 0.2 | 0.25 | 0.214 | 0.21 | 0.2 | 3 |
| ear_front_depth | 0.476 | 0.52 | 1.1 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.552 | 12 | 0.09 | 1 |
| head_w_over_h | 0.658 | 0.7 | 1.4 | 0.634 | 0.7 | 2.2 | 2 |
| head_depth_over_h | 0.939 | 0.86 | 2.63 | 0.946 | 0.88 | 2.2 | 2 |
| eye_w_over_head_w | 0.233 | 0.26 | 1.35 | 0.212 | 0.24 | 1.4 | 2 |
| gap_over_head_w | 0.207 | 0.26 | 2.12 | 0.236 | 0.24 | 0.16 | 1 |
| nose_w_over_head_w | 0.258 | 0.21 | 1.92 | 0.253 | 0.25 | 0.12 | 2 |
| mouth_w_over_head_w | 0.404 | 0.44 | 1.2 | 0.405 | 0.44 | 1.17 | 3 |
| mouth_w_over_pupil | 0.921 | 0.85 | 0.89 | 0.915 | 0.85 | 0.81 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.858** | | | **1.422** | |

### MakeHuman base, round 2: bigger iris texture, denser upper lashes, liner decal with flick, lids slid over the iris (lids field), neck slimmer, softer F face / leaner M face, lip colour, mouth closed

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.889 | 1.62 | 3.36 | 2.147 | 2.05 | 1.21 | 2 |
| waist_w_over_head_h | 1.142 | 1.0 | 2.37 | 1.192 | 1.25 | 0.97 | 2 |
| hip_w_over_head_h | 1.825 | 1.5 | 4.06 | 1.818 | 1.42 | 4.98 | 2 |
| waist_over_hip | 0.626 | 0.667 | 1.03 | 0.655 | 0.88 | 5.62 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.35 | 0.35 | 0.0 | 0.606 | 0.5 | 3.53 | 1 |
| neck_len_over_head_h | 0.555 | 0.36 | 4.88 | 0.427 | 0.32 | 2.67 | 1 |
| hand_len_over_head_h | 0.807 | 0.76 | 0.94 | 0.984 | 0.8 | 3.68 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | 0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.153 | 0.182 | 1.93 | 0.128 | 0.168 | 2.67 | 3 |
| eye_h_over_w | 0.234 | 0.38 | 3.65 | 0.224 | 0.36 | 3.4 | 3 |
| eye_tilt_deg | 4.47 | 9 | 1.51 | 3.403 | 5 | 0.53 | 2 |
| iris_d_over_eye_w | 0.543 | 0.45 | 2.33 | 0.554 | 0.45 | 2.6 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.219 | 1.0 | 2.74 | 1 |
| nose_w_over_face_w | 0.29 | 0.22 | 2.8 | 0.298 | 0.26 | 1.52 | 2 |
| nose_len_over_head_h | 0.2 | 0.22 | 0.8 | 0.172 | 0.23 | 2.32 | 1 |
| mouth_w_over_face_w | 0.445 | 0.46 | 0.5 | 0.46 | 0.46 | 0.0 | 3 |
| mouth_w_over_nose_w | 1.535 | >=1.8 | 2.65 | 1.542 | >=1.6 | 0.58 | 2 |
| lip_h_over_mouth_w | 0.42 | 0.3 | 3.0 | 0.387 | 0.25 | 3.43 | 3 |
| lip_h_over_head_h | 0.108 | 0.097 | 0.92 | 0.098 | 0.08 | 1.5 | 2 |
| chin_w_over_face_w | 0.662 | 0.3 | 7.24 | 0.685 | 0.4 | 5.7 | 2 |
| ear_h_over_head_h | 0.205 | 0.2 | 0.25 | 0.212 | 0.21 | 0.1 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.029 | 0.04 | 0.55 | 3 |
| eye_line_from_top | 0.496 | 0.52 | 0.8 | 0.487 | 0.51 | 0.77 | 1 |
| eyeball_d_over_eye_w | 1.208 | 1.12 | 1.47 | 1.231 | 1.12 | 1.85 | 1 |
| **weighted mean g (body/face rows)** | | | **1.845** | | | **2.036** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.419 | 0.39 | 1.45 | 0.408 | 0.4 | 0.4 | 2 |
| eye_line | 0.496 | 0.53 | 2.27 | 0.487 | 0.52 | 2.2 | 3 |
| eye_between_brow_and_nose | 0.273 | 0.45 | 3.54 | 0.31 | 0.39 | 1.6 | 1 |
| nose_tip | 0.642 | 0.64 | 0.1 | 0.651 | 0.66 | 0.45 | 1 |
| nose_base | 0.702 | 0.7 | 0.13 | 0.663 | 0.71 | 3.13 | 3 |
| mouth_line | 0.78 | 0.81 | 2.0 | 0.782 | 0.81 | 1.87 | 3 |
| lip_top | 0.736 | 0.769 | 2.75 | 0.748 | 0.776 | 2.33 | 2 |
| lip_bottom | 0.844 | 0.866 | 1.83 | 0.846 | 0.856 | 0.83 | 2 |
| lower_over_middle_third | 1.055 | 0.97 | 1.42 | 1.321 | 0.94 | 6.35 | 3 |
| ear_top | 0.49 | 0.46 | 1.5 | 0.46 | 0.45 | 0.5 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.672 | 0.66 | 0.6 | 2 |
| ear_h | 0.205 | 0.2 | 0.25 | 0.212 | 0.21 | 0.1 | 3 |
| ear_front_depth | 0.482 | 0.52 | 0.95 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 10.995 | 12 | 0.2 | 1 |
| head_w_over_h | 0.67 | 0.7 | 1.0 | 0.654 | 0.7 | 1.53 | 2 |
| head_depth_over_h | 0.948 | 0.86 | 2.93 | 0.934 | 0.88 | 1.8 | 2 |
| eye_w_over_head_w | 0.229 | 0.26 | 1.55 | 0.196 | 0.24 | 2.2 | 2 |
| gap_over_head_w | 0.216 | 0.26 | 1.76 | 0.239 | 0.24 | 0.04 | 1 |
| nose_w_over_head_w | 0.249 | 0.21 | 1.56 | 0.251 | 0.25 | 0.04 | 2 |
| mouth_w_over_head_w | 0.382 | 0.44 | 1.93 | 0.387 | 0.44 | 1.77 | 3 |
| mouth_w_over_pupil | 0.862 | 0.85 | 0.15 | 0.897 | 0.85 | 0.59 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.507** | | | **1.667** | |

### MakeHuman base, round 3: body widths solved with MakeHuman measure targets, mannequin smoothing (nipples, groin), M face leaner with heavier brows, lighter F lashes, thicker liner, cornea softer

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.748 | 1.62 | 1.6 | 2.098 | 2.05 | 0.6 | 2 |
| waist_w_over_head_h | 1.0 | 1.0 | 0.0 | 1.218 | 1.25 | 0.53 | 2 |
| hip_w_over_head_h | 1.5 | 1.5 | 0.0 | 1.645 | 1.42 | 2.81 | 2 |
| waist_over_hip | 0.666 | 0.667 | 0.03 | 0.74 | 0.88 | 3.5 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.35 | 0.35 | 0.0 | 0.45 | 0.5 | 1.67 | 1 |
| neck_len_over_head_h | 0.554 | 0.36 | 4.85 | 0.467 | 0.32 | 3.68 | 1 |
| hand_len_over_head_h | 0.805 | 0.76 | 0.9 | 0.986 | 0.8 | 3.72 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.153 | 0.182 | 1.93 | 0.147 | 0.168 | 1.4 | 3 |
| eye_h_over_w | 0.234 | 0.38 | 3.65 | 0.22 | 0.36 | 3.5 | 3 |
| eye_tilt_deg | 4.47 | 9 | 1.51 | 3.373 | 5 | 0.54 | 2 |
| iris_d_over_eye_w | 0.543 | 0.45 | 2.33 | 0.54 | 0.45 | 2.25 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.073 | 1.0 | 0.91 | 1 |
| nose_w_over_face_w | 0.29 | 0.22 | 2.8 | 0.3 | 0.26 | 1.6 | 2 |
| nose_len_over_head_h | 0.2 | 0.22 | 0.8 | 0.269 | 0.23 | 1.56 | 1 |
| mouth_w_over_face_w | 0.445 | 0.46 | 0.5 | 0.476 | 0.46 | 0.53 | 3 |
| mouth_w_over_nose_w | 1.535 | >=1.8 | 2.65 | 1.584 | >=1.6 | 0.16 | 2 |
| lip_h_over_mouth_w | 0.419 | 0.3 | 2.97 | 0.379 | 0.25 | 3.23 | 3 |
| lip_h_over_head_h | 0.107 | 0.097 | 0.83 | 0.102 | 0.08 | 1.83 | 2 |
| chin_w_over_face_w | 0.662 | 0.3 | 7.24 | 0.758 | 0.4 | 7.16 | 2 |
| ear_h_over_head_h | 0.205 | 0.2 | 0.25 | 0.226 | 0.21 | 0.8 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.496 | 0.52 | 0.8 | 0.487 | 0.51 | 0.77 | 1 |
| eyeball_d_over_eye_w | 1.208 | 1.12 | 1.47 | 1.199 | 1.12 | 1.32 | 1 |
| **weighted mean g (body/face rows)** | | | **1.472** | | | **1.75** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.419 | 0.39 | 1.45 | 0.422 | 0.4 | 1.1 | 2 |
| eye_line | 0.496 | 0.53 | 2.27 | 0.487 | 0.52 | 2.2 | 3 |
| eye_between_brow_and_nose | 0.273 | 0.45 | 3.54 | 0.191 | 0.39 | 3.98 | 1 |
| nose_tip | 0.642 | 0.64 | 0.1 | 0.661 | 0.66 | 0.05 | 1 |
| nose_base | 0.702 | 0.7 | 0.13 | 0.76 | 0.71 | 3.33 | 3 |
| mouth_line | 0.782 | 0.81 | 1.87 | 0.8 | 0.81 | 0.67 | 3 |
| lip_top | 0.736 | 0.769 | 2.75 | 0.764 | 0.776 | 1.0 | 2 |
| lip_bottom | 0.843 | 0.866 | 1.92 | 0.866 | 0.856 | 0.83 | 2 |
| lower_over_middle_third | 1.055 | 0.97 | 1.42 | 0.712 | 0.94 | 3.8 | 3 |
| ear_top | 0.49 | 0.46 | 1.5 | 0.457 | 0.45 | 0.35 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.683 | 0.66 | 1.15 | 2 |
| ear_h | 0.205 | 0.2 | 0.25 | 0.226 | 0.21 | 0.8 | 3 |
| ear_front_depth | 0.482 | 0.52 | 0.95 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.67 | 0.7 | 1.0 | 0.668 | 0.7 | 1.07 | 2 |
| head_depth_over_h | 0.948 | 0.86 | 2.93 | 0.996 | 0.88 | 3.87 | 2 |
| eye_w_over_head_w | 0.229 | 0.26 | 1.55 | 0.22 | 0.24 | 1.0 | 2 |
| gap_over_head_w | 0.216 | 0.26 | 1.76 | 0.237 | 0.24 | 0.12 | 1 |
| nose_w_over_head_w | 0.249 | 0.21 | 1.56 | 0.255 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.382 | 0.44 | 1.93 | 0.403 | 0.44 | 1.23 | 3 |
| mouth_w_over_pupil | 0.862 | 0.85 | 0.15 | 0.893 | 0.85 | 0.54 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.502** | | | **1.492** | |

### MakeHuman base, round 4: smaller upturned F nose, mouth closed (mouth-open -0.25), deeper lip colour and blush, lid crease decal, softer lashes, brighter sclera

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.733 | 1.62 | 1.41 | 2.08 | 2.05 | 0.38 | 2 |
| waist_w_over_head_h | 0.997 | 1.0 | 0.05 | 1.205 | 1.25 | 0.75 | 2 |
| hip_w_over_head_h | 1.487 | 1.5 | 0.16 | 1.631 | 1.42 | 2.64 | 2 |
| waist_over_hip | 0.67 | 0.667 | 0.08 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.349 | 0.35 | 0.03 | 0.462 | 0.5 | 1.27 | 1 |
| neck_len_over_head_h | 0.577 | 0.36 | 5.42 | 0.49 | 0.32 | 4.25 | 1 |
| hand_len_over_head_h | 0.798 | 0.76 | 0.76 | 0.977 | 0.8 | 3.54 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.157 | 0.182 | 1.67 | 0.149 | 0.168 | 1.27 | 3 |
| eye_h_over_w | 0.228 | 0.38 | 3.8 | 0.229 | 0.36 | 3.27 | 3 |
| eye_tilt_deg | 4.628 | 9 | 1.46 | 3.019 | 5 | 0.66 | 2 |
| iris_d_over_eye_w | 0.542 | 0.45 | 2.3 | 0.546 | 0.45 | 2.4 | 2 |
| inter_over_eye_w | 0.937 | 1.0 | 0.79 | 1.104 | 1.0 | 1.3 | 1 |
| nose_w_over_face_w | 0.29 | 0.22 | 2.8 | 0.3 | 0.26 | 1.6 | 2 |
| nose_len_over_head_h | 0.165 | 0.22 | 2.2 | 0.276 | 0.23 | 1.84 | 1 |
| mouth_w_over_face_w | 0.447 | 0.46 | 0.43 | 0.478 | 0.46 | 0.6 | 3 |
| mouth_w_over_nose_w | 1.543 | >=1.8 | 2.57 | 1.592 | >=1.6 | 0.08 | 2 |
| lip_h_over_mouth_w | 0.281 | 0.3 | 0.47 | 0.253 | 0.25 | 0.08 | 3 |
| lip_h_over_head_h | 0.074 | 0.097 | 1.92 | 0.07 | 0.08 | 0.83 | 2 |
| chin_w_over_face_w | 0.662 | 0.3 | 7.24 | 0.758 | 0.4 | 7.16 | 2 |
| ear_h_over_head_h | 0.21 | 0.2 | 0.5 | 0.231 | 0.21 | 1.05 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.508 | 0.52 | 0.4 | 0.497 | 0.51 | 0.43 | 1 |
| eyeball_d_over_eye_w | 1.205 | 1.12 | 1.42 | 1.212 | 1.12 | 1.53 | 1 |
| **weighted mean g (body/face rows)** | | | **1.399** | | | **1.541** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.429 | 0.39 | 1.95 | 0.432 | 0.4 | 1.6 | 2 |
| eye_line | 0.508 | 0.53 | 1.47 | 0.497 | 0.52 | 1.53 | 3 |
| eye_between_brow_and_nose | 0.316 | 0.45 | 2.68 | 0.188 | 0.39 | 4.04 | 1 |
| nose_tip | 0.653 | 0.64 | 0.65 | 0.676 | 0.66 | 0.8 | 1 |
| nose_base | 0.68 | 0.7 | 1.33 | 0.777 | 0.71 | 4.47 | 3 |
| mouth_line | 0.802 | 0.81 | 0.53 | 0.819 | 0.81 | 0.6 | 3 |
| lip_top | 0.754 | 0.769 | 1.25 | 0.781 | 0.776 | 0.42 | 2 |
| lip_bottom | 0.828 | 0.866 | 3.17 | 0.851 | 0.856 | 0.42 | 2 |
| lower_over_middle_third | 1.279 | 0.97 | 5.15 | 0.645 | 0.94 | 4.92 | 3 |
| ear_top | 0.501 | 0.46 | 2.05 | 0.467 | 0.45 | 0.85 | 2 |
| ear_bottom | 0.711 | 0.66 | 2.55 | 0.698 | 0.66 | 1.9 | 2 |
| ear_h | 0.21 | 0.2 | 0.5 | 0.231 | 0.21 | 1.05 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.686 | 0.7 | 0.47 | 0.683 | 0.7 | 0.57 | 2 |
| head_depth_over_h | 0.967 | 0.86 | 3.57 | 1.019 | 0.88 | 4.63 | 2 |
| eye_w_over_head_w | 0.229 | 0.26 | 1.55 | 0.218 | 0.24 | 1.1 | 2 |
| gap_over_head_w | 0.215 | 0.26 | 1.8 | 0.241 | 0.24 | 0.04 | 1 |
| nose_w_over_head_w | 0.249 | 0.21 | 1.56 | 0.255 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.385 | 0.44 | 1.83 | 0.405 | 0.44 | 1.17 | 3 |
| mouth_w_over_pupil | 0.869 | 0.85 | 0.24 | 0.895 | 0.85 | 0.56 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.787** | | | **1.681** | |

### MakeHuman base, round 5: lips: gentler closing, fuller upper lip; M: bigger eyes, leaner cheeks; F lashes opaque again

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.742 | 1.62 | 1.52 | 2.089 | 2.05 | 0.49 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.213 | 1.25 | 0.62 | 2 |
| hip_w_over_head_h | 1.495 | 1.5 | 0.06 | 1.638 | 1.42 | 2.72 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.74 | 0.88 | 3.5 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.354 | 0.35 | 0.13 | 0.456 | 0.5 | 1.47 | 1 |
| neck_len_over_head_h | 0.563 | 0.36 | 5.07 | 0.478 | 0.32 | 3.95 | 1 |
| hand_len_over_head_h | 0.803 | 0.76 | 0.86 | 0.982 | 0.8 | 3.64 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.157 | 0.182 | 1.67 | 0.156 | 0.168 | 0.8 | 3 |
| eye_h_over_w | 0.228 | 0.38 | 3.8 | 0.23 | 0.36 | 3.25 | 3 |
| eye_tilt_deg | 4.568 | 9 | 1.48 | 3.383 | 5 | 0.54 | 2 |
| iris_d_over_eye_w | 0.535 | 0.45 | 2.13 | 0.539 | 0.45 | 2.23 | 2 |
| inter_over_eye_w | 0.906 | 1.0 | 1.17 | 0.987 | 1.0 | 0.16 | 1 |
| nose_w_over_face_w | 0.294 | 0.22 | 2.96 | 0.308 | 0.26 | 1.92 | 2 |
| nose_len_over_head_h | 0.189 | 0.22 | 1.24 | 0.271 | 0.23 | 1.64 | 1 |
| mouth_w_over_face_w | 0.448 | 0.46 | 0.4 | 0.484 | 0.46 | 0.8 | 3 |
| mouth_w_over_nose_w | 1.528 | >=1.8 | 2.72 | 1.571 | >=1.6 | 0.29 | 2 |
| lip_h_over_mouth_w | 0.377 | 0.3 | 1.93 | 0.332 | 0.25 | 2.05 | 3 |
| lip_h_over_head_h | 0.098 | 0.097 | 0.08 | 0.09 | 0.08 | 0.83 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.766 | 0.4 | 7.32 | 2 |
| ear_h_over_head_h | 0.207 | 0.2 | 0.35 | 0.228 | 0.21 | 0.9 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.501 | 0.52 | 0.63 | 0.493 | 0.51 | 0.57 | 1 |
| eyeball_d_over_eye_w | 1.19 | 1.12 | 1.17 | 1.197 | 1.12 | 1.28 | 1 |
| **weighted mean g (body/face rows)** | | | **1.427** | | | **1.617** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.423 | 0.39 | 1.65 | 0.424 | 0.4 | 1.2 | 2 |
| eye_line | 0.501 | 0.53 | 1.93 | 0.493 | 0.52 | 1.8 | 3 |
| eye_between_brow_and_nose | 0.286 | 0.45 | 3.28 | 0.198 | 0.39 | 3.84 | 1 |
| nose_tip | 0.644 | 0.64 | 0.2 | 0.668 | 0.66 | 0.4 | 1 |
| nose_base | 0.697 | 0.7 | 0.2 | 0.768 | 0.71 | 3.87 | 3 |
| mouth_line | 0.795 | 0.81 | 1.0 | 0.809 | 0.81 | 0.07 | 3 |
| lip_top | 0.74 | 0.769 | 2.42 | 0.772 | 0.776 | 0.33 | 2 |
| lip_bottom | 0.837 | 0.866 | 2.42 | 0.862 | 0.856 | 0.5 | 2 |
| lower_over_middle_third | 1.109 | 0.97 | 2.32 | 0.673 | 0.94 | 4.45 | 3 |
| ear_top | 0.494 | 0.46 | 1.7 | 0.462 | 0.45 | 0.6 | 2 |
| ear_bottom | 0.701 | 0.66 | 2.05 | 0.69 | 0.66 | 1.5 | 2 |
| ear_h | 0.207 | 0.2 | 0.35 | 0.228 | 0.21 | 0.9 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.677 | 0.7 | 0.77 | 0.676 | 0.7 | 0.8 | 2 |
| head_depth_over_h | 0.953 | 0.86 | 3.1 | 1.007 | 0.88 | 4.23 | 2 |
| eye_w_over_head_w | 0.232 | 0.26 | 1.4 | 0.232 | 0.24 | 0.4 | 2 |
| gap_over_head_w | 0.21 | 0.26 | 2.0 | 0.229 | 0.24 | 0.44 | 1 |
| nose_w_over_head_w | 0.251 | 0.21 | 1.64 | 0.255 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.383 | 0.44 | 1.9 | 0.4 | 0.44 | 1.33 | 3 |
| mouth_w_over_pupil | 0.868 | 0.85 | 0.23 | 0.881 | 0.85 | 0.39 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.533** | | | **1.49** | |

### MakeHuman base, round 6: M: softer cheeks (no gauntness), shorter chin, smoother laugh lines and eye bags; F: lips less tall, laugh lines and eye bags smoothed

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.742 | 1.62 | 1.52 | 2.086 | 2.05 | 0.45 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.211 | 1.25 | 0.65 | 2 |
| hip_w_over_head_h | 1.495 | 1.5 | 0.06 | 1.636 | 1.42 | 2.7 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.74 | 0.88 | 3.5 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.354 | 0.35 | 0.13 | 0.459 | 0.5 | 1.37 | 1 |
| neck_len_over_head_h | 0.563 | 0.36 | 5.07 | 0.482 | 0.32 | 4.05 | 1 |
| hand_len_over_head_h | 0.803 | 0.76 | 0.86 | 0.98 | 0.8 | 3.6 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.157 | 0.182 | 1.67 | 0.157 | 0.168 | 0.73 | 3 |
| eye_h_over_w | 0.228 | 0.38 | 3.8 | 0.24 | 0.36 | 3.0 | 3 |
| eye_tilt_deg | 4.568 | 9 | 1.48 | 3.266 | 5 | 0.58 | 2 |
| iris_d_over_eye_w | 0.535 | 0.45 | 2.13 | 0.539 | 0.45 | 2.23 | 2 |
| inter_over_eye_w | 0.906 | 1.0 | 1.17 | 0.986 | 1.0 | 0.18 | 1 |
| nose_w_over_face_w | 0.294 | 0.22 | 2.96 | 0.299 | 0.26 | 1.56 | 2 |
| nose_len_over_head_h | 0.189 | 0.22 | 1.24 | 0.273 | 0.23 | 1.72 | 1 |
| mouth_w_over_face_w | 0.448 | 0.46 | 0.4 | 0.475 | 0.46 | 0.5 | 3 |
| mouth_w_over_nose_w | 1.528 | >=1.8 | 2.72 | 1.59 | >=1.6 | 0.1 | 2 |
| lip_h_over_mouth_w | 0.368 | 0.3 | 1.7 | 0.325 | 0.25 | 1.88 | 3 |
| lip_h_over_head_h | 0.095 | 0.097 | 0.17 | 0.089 | 0.08 | 0.75 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.207 | 0.2 | 0.35 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.501 | 0.52 | 0.63 | 0.495 | 0.51 | 0.5 | 1 |
| eyeball_d_over_eye_w | 1.189 | 1.12 | 1.15 | 1.199 | 1.12 | 1.32 | 1 |
| **weighted mean g (body/face rows)** | | | **1.417** | | | **1.547** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.423 | 0.39 | 1.65 | 0.422 | 0.4 | 1.1 | 2 |
| eye_line | 0.501 | 0.53 | 1.93 | 0.495 | 0.52 | 1.67 | 3 |
| eye_between_brow_and_nose | 0.286 | 0.45 | 3.28 | 0.208 | 0.39 | 3.64 | 1 |
| nose_tip | 0.644 | 0.64 | 0.2 | 0.671 | 0.66 | 0.55 | 1 |
| nose_base | 0.697 | 0.7 | 0.2 | 0.772 | 0.71 | 4.13 | 3 |
| mouth_line | 0.795 | 0.81 | 1.0 | 0.813 | 0.81 | 0.2 | 3 |
| lip_top | 0.741 | 0.769 | 2.33 | 0.776 | 0.776 | 0.0 | 2 |
| lip_bottom | 0.837 | 0.866 | 2.42 | 0.865 | 0.856 | 0.75 | 2 |
| lower_over_middle_third | 1.11 | 0.97 | 2.33 | 0.653 | 0.94 | 4.78 | 3 |
| ear_top | 0.494 | 0.46 | 1.7 | 0.464 | 0.45 | 0.7 | 2 |
| ear_bottom | 0.701 | 0.66 | 2.05 | 0.693 | 0.66 | 1.65 | 2 |
| ear_h | 0.207 | 0.2 | 0.35 | 0.229 | 0.21 | 0.95 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.677 | 0.7 | 0.77 | 0.678 | 0.7 | 0.73 | 2 |
| head_depth_over_h | 0.953 | 0.86 | 3.1 | 1.011 | 0.88 | 4.37 | 2 |
| eye_w_over_head_w | 0.232 | 0.26 | 1.4 | 0.231 | 0.24 | 0.45 | 2 |
| gap_over_head_w | 0.21 | 0.26 | 2.0 | 0.228 | 0.24 | 0.48 | 1 |
| nose_w_over_head_w | 0.251 | 0.21 | 1.64 | 0.255 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.383 | 0.44 | 1.9 | 0.405 | 0.44 | 1.17 | 3 |
| mouth_w_over_pupil | 0.868 | 0.85 | 0.23 | 0.894 | 0.85 | 0.55 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.529** | | | **1.536** | |

### MakeHuman base, round 7: soften field (no nasolabial creases), M mouth narrower without compression

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.742 | 1.62 | 1.52 | 2.086 | 2.05 | 0.45 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.211 | 1.25 | 0.65 | 2 |
| hip_w_over_head_h | 1.495 | 1.5 | 0.06 | 1.636 | 1.42 | 2.7 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.74 | 0.88 | 3.5 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.354 | 0.35 | 0.13 | 0.459 | 0.5 | 1.37 | 1 |
| neck_len_over_head_h | 0.563 | 0.36 | 5.07 | 0.482 | 0.32 | 4.05 | 1 |
| hand_len_over_head_h | 0.803 | 0.76 | 0.86 | 0.98 | 0.8 | 3.6 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.157 | 0.182 | 1.67 | 0.157 | 0.168 | 0.73 | 3 |
| eye_h_over_w | 0.228 | 0.38 | 3.8 | 0.24 | 0.36 | 3.0 | 3 |
| eye_tilt_deg | 4.568 | 9 | 1.48 | 3.266 | 5 | 0.58 | 2 |
| iris_d_over_eye_w | 0.535 | 0.45 | 2.13 | 0.539 | 0.45 | 2.23 | 2 |
| inter_over_eye_w | 0.906 | 1.0 | 1.17 | 0.986 | 1.0 | 0.18 | 1 |
| nose_w_over_face_w | 0.291 | 0.22 | 2.84 | 0.287 | 0.26 | 1.08 | 2 |
| nose_len_over_head_h | 0.191 | 0.22 | 1.16 | 0.219 | 0.23 | 0.44 | 1 |
| mouth_w_over_face_w | 0.433 | 0.46 | 0.9 | 0.447 | 0.46 | 0.43 | 3 |
| mouth_w_over_nose_w | 1.489 | >=1.8 | 3.11 | 1.557 | >=1.6 | 0.43 | 2 |
| lip_h_over_mouth_w | 0.382 | 0.3 | 2.05 | 0.357 | 0.25 | 2.67 | 3 |
| lip_h_over_head_h | 0.095 | 0.097 | 0.17 | 0.092 | 0.08 | 1.0 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.207 | 0.2 | 0.35 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.501 | 0.52 | 0.63 | 0.495 | 0.51 | 0.5 | 1 |
| eyeball_d_over_eye_w | 1.189 | 1.12 | 1.15 | 1.199 | 1.12 | 1.32 | 1 |
| **weighted mean g (body/face rows)** | | | **1.473** | | | **1.567** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.423 | 0.39 | 1.65 | 0.422 | 0.4 | 1.1 | 2 |
| eye_line | 0.501 | 0.53 | 1.93 | 0.495 | 0.52 | 1.67 | 3 |
| eye_between_brow_and_nose | 0.284 | 0.45 | 3.32 | 0.245 | 0.39 | 2.9 | 1 |
| nose_tip | 0.644 | 0.64 | 0.2 | 0.671 | 0.66 | 0.55 | 1 |
| nose_base | 0.699 | 0.7 | 0.07 | 0.718 | 0.71 | 0.53 | 3 |
| mouth_line | 0.795 | 0.81 | 1.0 | 0.814 | 0.81 | 0.27 | 3 |
| lip_top | 0.741 | 0.769 | 2.33 | 0.773 | 0.776 | 0.25 | 2 |
| lip_bottom | 0.837 | 0.866 | 2.42 | 0.866 | 0.856 | 0.83 | 2 |
| lower_over_middle_third | 1.094 | 0.97 | 2.07 | 0.954 | 0.94 | 0.23 | 3 |
| ear_top | 0.494 | 0.46 | 1.7 | 0.464 | 0.45 | 0.7 | 2 |
| ear_bottom | 0.701 | 0.66 | 2.05 | 0.693 | 0.66 | 1.65 | 2 |
| ear_h | 0.207 | 0.2 | 0.35 | 0.229 | 0.21 | 0.95 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.677 | 0.7 | 0.77 | 0.678 | 0.7 | 0.73 | 2 |
| head_depth_over_h | 0.953 | 0.86 | 3.1 | 1.011 | 0.88 | 4.37 | 2 |
| eye_w_over_head_w | 0.232 | 0.26 | 1.4 | 0.231 | 0.24 | 0.45 | 2 |
| gap_over_head_w | 0.21 | 0.26 | 2.0 | 0.228 | 0.24 | 0.48 | 1 |
| nose_w_over_head_w | 0.248 | 0.21 | 1.52 | 0.245 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.37 | 0.44 | 2.33 | 0.381 | 0.44 | 1.97 | 3 |
| mouth_w_over_pupil | 0.837 | 0.85 | 0.16 | 0.842 | 0.85 | 0.1 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.526** | | | **1.016** | |

### MakeHuman base, round 8: Loomis: eyes 4-5 mm lower in the face, forehead slightly shorter, F mouth lower

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.085 | 2.05 | 0.44 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.208 | 1.25 | 0.7 | 2 |
| hip_w_over_head_h | 1.494 | 1.5 | 0.08 | 1.635 | 1.42 | 2.69 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.361 | 0.35 | 0.37 | 0.464 | 0.5 | 1.2 | 1 |
| neck_len_over_head_h | 0.565 | 0.36 | 5.12 | 0.484 | 0.32 | 4.1 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.98 | 0.8 | 3.6 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.159 | 0.182 | 1.53 | 0.157 | 0.168 | 0.73 | 3 |
| eye_h_over_w | 0.262 | 0.38 | 2.95 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 5.494 | 9 | 1.17 | 3.473 | 5 | 0.51 | 2 |
| iris_d_over_eye_w | 0.538 | 0.45 | 2.2 | 0.548 | 0.45 | 2.45 | 2 |
| inter_over_eye_w | 0.93 | 1.0 | 0.87 | 1.019 | 1.0 | 0.24 | 1 |
| nose_w_over_face_w | 0.29 | 0.22 | 2.8 | 0.287 | 0.26 | 1.08 | 2 |
| nose_len_over_head_h | 0.173 | 0.22 | 1.88 | 0.204 | 0.23 | 1.04 | 1 |
| mouth_w_over_face_w | 0.433 | 0.46 | 0.9 | 0.447 | 0.46 | 0.43 | 3 |
| mouth_w_over_nose_w | 1.489 | >=1.8 | 3.11 | 1.557 | >=1.6 | 0.43 | 2 |
| lip_h_over_mouth_w | 0.382 | 0.3 | 2.05 | 0.357 | 0.25 | 2.67 | 3 |
| lip_h_over_head_h | 0.097 | 0.097 | 0.0 | 0.094 | 0.08 | 1.17 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.513 | 0.52 | 0.23 | 0.505 | 0.51 | 0.17 | 1 |
| eyeball_d_over_eye_w | 1.196 | 1.12 | 1.27 | 1.218 | 1.12 | 1.63 | 1 |
| **weighted mean g (body/face rows)** | | | **1.419** | | | **1.569** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.423 | 0.39 | 1.65 | 0.428 | 0.4 | 1.4 | 2 |
| eye_line | 0.513 | 0.53 | 1.13 | 0.505 | 0.52 | 1.0 | 3 |
| eye_between_brow_and_nose | 0.333 | 0.45 | 2.34 | 0.27 | 0.39 | 2.4 | 1 |
| nose_tip | 0.637 | 0.64 | 0.15 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.693 | 0.7 | 0.47 | 0.714 | 0.71 | 0.27 | 3 |
| mouth_line | 0.807 | 0.81 | 0.2 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.753 | 0.769 | 1.33 | 0.77 | 0.776 | 0.5 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.863 | 0.856 | 0.58 | 2 |
| lower_over_middle_third | 1.134 | 0.97 | 2.73 | 1.001 | 0.94 | 1.02 | 3 |
| ear_top | 0.483 | 0.46 | 1.15 | 0.456 | 0.45 | 0.3 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.689 | 0.66 | 1.45 | 2 |
| ear_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.691 | 0.7 | 0.3 | 0.689 | 0.7 | 0.37 | 2 |
| head_depth_over_h | 0.974 | 0.86 | 3.8 | 1.027 | 0.88 | 4.9 | 2 |
| eye_w_over_head_w | 0.231 | 0.26 | 1.45 | 0.228 | 0.24 | 0.6 | 2 |
| gap_over_head_w | 0.215 | 0.26 | 1.8 | 0.232 | 0.24 | 0.32 | 1 |
| nose_w_over_head_w | 0.248 | 0.21 | 1.52 | 0.245 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.37 | 0.44 | 2.33 | 0.381 | 0.44 | 1.97 | 3 |
| mouth_w_over_pupil | 0.833 | 0.85 | 0.21 | 0.841 | 0.85 | 0.11 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.348** | | | **0.986** | |

### MakeHuman base, round 9: eyes 3 mm lower instead of 5, F brows lowered (less surprised)

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.085 | 2.05 | 0.44 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.208 | 1.25 | 0.7 | 2 |
| hip_w_over_head_h | 1.494 | 1.5 | 0.08 | 1.635 | 1.42 | 2.69 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.361 | 0.35 | 0.37 | 0.464 | 0.5 | 1.2 | 1 |
| neck_len_over_head_h | 0.565 | 0.36 | 5.12 | 0.484 | 0.32 | 4.1 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.98 | 0.8 | 3.6 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.003 | 0.0 | 0.2 | 1 |
| eye_w_over_head_h | 0.159 | 0.182 | 1.53 | 0.157 | 0.168 | 0.73 | 3 |
| eye_h_over_w | 0.237 | 0.38 | 3.58 | 0.252 | 0.36 | 2.7 | 3 |
| eye_tilt_deg | 5.14 | 9 | 1.29 | 3.069 | 5 | 0.64 | 2 |
| iris_d_over_eye_w | 0.539 | 0.45 | 2.23 | 0.548 | 0.45 | 2.45 | 2 |
| inter_over_eye_w | 0.931 | 1.0 | 0.86 | 1.018 | 1.0 | 0.23 | 1 |
| nose_w_over_face_w | 0.29 | 0.22 | 2.8 | 0.287 | 0.26 | 1.08 | 2 |
| nose_len_over_head_h | 0.183 | 0.22 | 1.48 | 0.21 | 0.23 | 0.8 | 1 |
| mouth_w_over_face_w | 0.433 | 0.46 | 0.9 | 0.447 | 0.46 | 0.43 | 3 |
| mouth_w_over_nose_w | 1.489 | >=1.8 | 3.11 | 1.557 | >=1.6 | 0.43 | 2 |
| lip_h_over_mouth_w | 0.382 | 0.3 | 2.05 | 0.357 | 0.25 | 2.67 | 3 |
| lip_h_over_head_h | 0.097 | 0.097 | 0.0 | 0.094 | 0.08 | 1.17 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.503 | 0.52 | 0.57 | 0.5 | 0.51 | 0.33 | 1 |
| eyeball_d_over_eye_w | 1.198 | 1.12 | 1.3 | 1.217 | 1.12 | 1.62 | 1 |
| **weighted mean g (body/face rows)** | | | **1.46** | | | **1.589** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.423 | 0.39 | 1.65 | 0.424 | 0.4 | 1.2 | 2 |
| eye_line | 0.503 | 0.53 | 1.8 | 0.5 | 0.52 | 1.33 | 3 |
| eye_between_brow_and_nose | 0.297 | 0.45 | 3.06 | 0.262 | 0.39 | 2.56 | 1 |
| nose_tip | 0.637 | 0.64 | 0.15 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.693 | 0.7 | 0.47 | 0.714 | 0.71 | 0.27 | 3 |
| mouth_line | 0.807 | 0.81 | 0.2 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.753 | 0.769 | 1.33 | 0.77 | 0.776 | 0.5 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.863 | 0.856 | 0.58 | 2 |
| lower_over_middle_third | 1.137 | 0.97 | 2.78 | 0.989 | 0.94 | 0.82 | 3 |
| ear_top | 0.483 | 0.46 | 1.15 | 0.456 | 0.45 | 0.3 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.689 | 0.66 | 1.45 | 2 |
| ear_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.691 | 0.7 | 0.3 | 0.689 | 0.7 | 0.37 | 2 |
| head_depth_over_h | 0.974 | 0.86 | 3.8 | 1.027 | 0.88 | 4.9 | 2 |
| eye_w_over_head_w | 0.231 | 0.26 | 1.45 | 0.228 | 0.24 | 0.6 | 2 |
| gap_over_head_w | 0.215 | 0.26 | 1.8 | 0.232 | 0.24 | 0.32 | 1 |
| nose_w_over_head_w | 0.248 | 0.21 | 1.52 | 0.245 | 0.25 | 0.2 | 2 |
| mouth_w_over_head_w | 0.37 | 0.44 | 2.33 | 0.381 | 0.44 | 1.97 | 3 |
| mouth_w_over_pupil | 0.833 | 0.85 | 0.21 | 0.841 | 0.85 | 0.11 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.415** | | | **0.99** | |

### MakeHuman base, round 10: bigger eyes (field 1.25) further apart, wider mouth (MakeHuman lip width targets), stronger mannequin smoothing; nose measured on the stricter nose region (score 0.45; the wider mouth leaked lip skin into the 0.25 region)

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.089 | 2.05 | 0.49 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.21 | 1.25 | 0.67 | 2 |
| hip_w_over_head_h | 1.494 | 1.5 | 0.08 | 1.638 | 1.42 | 2.72 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.361 | 0.35 | 0.37 | 0.465 | 0.5 | 1.17 | 1 |
| neck_len_over_head_h | 0.565 | 0.36 | 5.12 | 0.484 | 0.32 | 4.1 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.981 | 0.8 | 3.62 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.169 | 0.182 | 0.87 | 0.162 | 0.168 | 0.4 | 3 |
| eye_h_over_w | 0.235 | 0.38 | 3.63 | 0.244 | 0.36 | 2.9 | 3 |
| eye_tilt_deg | 5.234 | 9 | 1.26 | 3.166 | 5 | 0.61 | 2 |
| iris_d_over_eye_w | 0.536 | 0.45 | 2.15 | 0.547 | 0.45 | 2.43 | 2 |
| inter_over_eye_w | 0.891 | 1.0 | 1.36 | 1.016 | 1.0 | 0.2 | 1 |
| nose_w_over_face_w | 0.286 | 0.22 | 2.64 | 0.274 | 0.26 | 0.56 | 2 |
| nose_len_over_head_h | 0.149 | 0.22 | 2.84 | 0.263 | 0.23 | 1.32 | 1 |
| mouth_w_over_face_w | 0.476 | 0.46 | 0.53 | 0.485 | 0.46 | 0.83 | 3 |
| mouth_w_over_nose_w | 1.666 | >=1.8 | 1.34 | 1.77 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.347 | 0.3 | 1.17 | 0.329 | 0.25 | 1.98 | 3 |
| lip_h_over_head_h | 0.097 | 0.097 | 0.0 | 0.094 | 0.08 | 1.17 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.504 | 0.52 | 0.53 | 0.5 | 0.51 | 0.33 | 1 |
| eyeball_d_over_eye_w | 1.191 | 1.12 | 1.18 | 1.216 | 1.12 | 1.6 | 1 |
| **weighted mean g (body/face rows)** | | | **1.31** | | | **1.54** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.421 | 0.39 | 1.55 | 0.44 | 0.4 | 2.0 | 2 |
| eye_line | 0.504 | 0.53 | 1.73 | 0.5 | 0.52 | 1.33 | 3 |
| eye_between_brow_and_nose | 0.346 | 0.45 | 2.08 | 0.185 | 0.39 | 4.1 | 1 |
| nose_tip | 0.637 | 0.64 | 0.15 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.661 | 0.7 | 2.6 | 0.768 | 0.71 | 3.87 | 3 |
| mouth_line | 0.807 | 0.81 | 0.2 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.753 | 0.769 | 1.33 | 0.77 | 0.776 | 0.5 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.863 | 0.856 | 0.58 | 2 |
| lower_over_middle_third | 1.412 | 0.97 | 7.37 | 0.706 | 0.94 | 3.9 | 3 |
| ear_top | 0.483 | 0.46 | 1.15 | 0.456 | 0.45 | 0.3 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.689 | 0.66 | 1.45 | 2 |
| ear_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_front_depth | 0.48 | 0.52 | 1.0 | 0.479 | 0.52 | 1.03 | 2 |
| ear_tilt_deg | 15.943 | 12 | 0.79 | 11.13 | 12 | 0.17 | 1 |
| head_w_over_h | 0.691 | 0.7 | 0.3 | 0.689 | 0.7 | 0.37 | 2 |
| head_depth_over_h | 0.974 | 0.86 | 3.8 | 1.027 | 0.88 | 4.9 | 2 |
| eye_w_over_head_w | 0.245 | 0.26 | 0.75 | 0.235 | 0.24 | 0.25 | 2 |
| gap_over_head_w | 0.218 | 0.26 | 1.68 | 0.239 | 0.24 | 0.04 | 1 |
| nose_w_over_head_w | 0.244 | 0.21 | 1.36 | 0.233 | 0.25 | 0.68 | 2 |
| mouth_w_over_head_w | 0.407 | 0.44 | 1.1 | 0.413 | 0.44 | 0.9 | 3 |
| mouth_w_over_pupil | 0.882 | 0.85 | 0.4 | 0.882 | 0.85 | 0.4 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.728** | | | **1.46** | |

### MakeHuman base, round 11: lids opened (upper 3 / 2 degrees), outer corner higher, shallower back of skull; subnasale = fixed hm08 vertex (columella base) from this round on

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.088 | 2.05 | 0.48 | 2 |
| waist_w_over_head_h | 0.998 | 1.0 | 0.03 | 1.21 | 1.25 | 0.67 | 2 |
| hip_w_over_head_h | 1.494 | 1.5 | 0.08 | 1.638 | 1.42 | 2.72 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.361 | 0.35 | 0.37 | 0.465 | 0.5 | 1.17 | 1 |
| neck_len_over_head_h | 0.565 | 0.36 | 5.12 | 0.485 | 0.32 | 4.12 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.981 | 0.8 | 3.62 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.17 | 0.182 | 0.8 | 0.162 | 0.168 | 0.4 | 3 |
| eye_h_over_w | 0.246 | 0.38 | 3.35 | 0.256 | 0.36 | 2.6 | 3 |
| eye_tilt_deg | 5.993 | 9 | 1.0 | 3.659 | 5 | 0.45 | 2 |
| iris_d_over_eye_w | 0.535 | 0.45 | 2.13 | 0.548 | 0.45 | 2.45 | 2 |
| inter_over_eye_w | 0.889 | 1.0 | 1.39 | 1.019 | 1.0 | 0.24 | 1 |
| nose_w_over_face_w | 0.286 | 0.22 | 2.64 | 0.274 | 0.26 | 0.56 | 2 |
| nose_len_over_head_h | 0.241 | 0.22 | 0.84 | 0.264 | 0.23 | 1.36 | 1 |
| mouth_w_over_face_w | 0.476 | 0.46 | 0.53 | 0.485 | 0.46 | 0.83 | 3 |
| mouth_w_over_nose_w | 1.666 | >=1.8 | 1.34 | 1.77 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.347 | 0.3 | 1.17 | 0.329 | 0.25 | 1.98 | 3 |
| lip_h_over_head_h | 0.098 | 0.097 | 0.08 | 0.094 | 0.08 | 1.17 | 2 |
| chin_w_over_face_w | 0.708 | 0.3 | 8.16 | 0.759 | 0.4 | 7.18 | 2 |
| ear_h_over_head_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.502 | 0.52 | 0.6 | 0.501 | 0.51 | 0.3 | 1 |
| eyeball_d_over_eye_w | 1.189 | 1.12 | 1.15 | 1.219 | 1.12 | 1.65 | 1 |
| **weighted mean g (body/face rows)** | | | **1.246** | | | **1.519** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.42 | 0.39 | 1.5 | 0.439 | 0.4 | 1.95 | 2 |
| eye_line | 0.502 | 0.53 | 1.87 | 0.501 | 0.52 | 1.27 | 3 |
| eye_between_brow_and_nose | 0.247 | 0.45 | 4.06 | 0.187 | 0.39 | 4.06 | 1 |
| nose_tip | 0.636 | 0.64 | 0.2 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.753 | 0.7 | 3.53 | 0.77 | 0.71 | 4.0 | 3 |
| mouth_line | 0.807 | 0.81 | 0.2 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.753 | 0.769 | 1.33 | 0.77 | 0.776 | 0.5 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.863 | 0.856 | 0.58 | 2 |
| lower_over_middle_third | 0.744 | 0.97 | 3.77 | 0.696 | 0.94 | 4.07 | 3 |
| ear_top | 0.483 | 0.46 | 1.15 | 0.455 | 0.45 | 0.25 | 2 |
| ear_bottom | 0.694 | 0.66 | 1.7 | 0.688 | 0.66 | 1.4 | 2 |
| ear_h | 0.211 | 0.2 | 0.55 | 0.233 | 0.21 | 1.15 | 3 |
| ear_front_depth | 0.515 | 0.52 | 0.13 | 0.507 | 0.52 | 0.33 | 2 |
| ear_tilt_deg | 15.903 | 12 | 0.78 | 11.098 | 12 | 0.18 | 1 |
| head_w_over_h | 0.692 | 0.7 | 0.27 | 0.69 | 0.7 | 0.33 | 2 |
| head_depth_over_h | 0.908 | 0.86 | 1.6 | 0.971 | 0.88 | 3.03 | 2 |
| eye_w_over_head_w | 0.245 | 0.26 | 0.75 | 0.235 | 0.24 | 0.25 | 2 |
| gap_over_head_w | 0.218 | 0.26 | 1.68 | 0.239 | 0.24 | 0.04 | 1 |
| nose_w_over_head_w | 0.244 | 0.21 | 1.36 | 0.233 | 0.25 | 0.68 | 2 |
| mouth_w_over_head_w | 0.407 | 0.44 | 1.1 | 0.413 | 0.44 | 0.9 | 3 |
| mouth_w_over_pupil | 0.882 | 0.85 | 0.4 | 0.882 | 0.85 | 0.4 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.452** | | | **1.348** | |

### MakeHuman base: summary after round 11 (user checkpoint, 2026-11-17)

Weighted mean g (lower is better; pass <= 0.6):

| | body/face F | body/face M | Loomis F | Loomis M |
|---|---|---|---|---|
| round 1 (MakeHuman neutral, first recipe) | 1.816 | 1.883 | 1.858 | 1.422 |
| round 11 (latest) | 1.246 | 1.519 | 1.452 | 1.348 |
| scan base, round 15 (for reference) | 1.883 | 1.801 | 0.830 | 0.602 |

Measurement notes: from round 10 the nose rows use the stricter nose region (score > 0.45), from round 11 the subnasale is a
fixed hm08 vertex (columella base); nose_base / lower_over_middle_third before round 11 are not comparable. `neck_len` uses
MakeHuman's clavicle joint as the notch and reads long (0.57 / 0.48 vs 0.36 / 0.32): a definition difference, not checked
further. `chin_w_over_face_w` (g about 8) keeps the plan's slice definition, which on MakeHuman catches the jaw: not meaningful.

By eye (round 11, `mh/mh_round11_face.png`, `mh/mh_round11_features.png`, `mh/checkpoint_*.png`):
- Fixed against the scan base: real eyelids, eyeballs, lashes, brows, teeth and tongue; no slits, no ledge under the nose,
  lips are modelled, faces read as people, nothing creepy in the neutral faces.
- Eyes: large almond eyes with the lid over the top of the iris, liner with an outer flick, big clear iris (1.32x texture).
  Still short of the reference: lashes are strand cards (fuzzy fringe) rather than one crisp lash/liner mass; the lid crease
  shade is faint; the eye opening is narrower than the target (h/w 0.24 vs 0.38) because the lids were lowered for the
  heavy-lid look.
- Nose: F small and slightly upturned, M straight; still more realistic than the reference's button nose.
- Mouth: wide (0.48 of face width F), full; the F lips read slightly too heavy, lip colour is a vertex tint (no texture yet).
- Overall the faces sit between MakeHuman realism and the reference's stylisation: skin is smooth and the head small
  (8.2 / 8.0 heads), but the reference's very soft, rounded "animated film" shapes (round cheeks, tiny chin) are only partly
  reached with MakeHuman's target ranges.

### MakeHuman base, round 12: USER FEEDBACK (frog eyes, cheeks, brow): eyes smaller (MH eye-scale 0.9, field 1.04) and closer (eye-trans-in), seated 1.5 mm deeper, lids over the top of the iris, iris texture 1.12x; strand lashes replaced by a solid lash ribbon + liner decal on the lid with a flick; cheeks: soft Laplacian cheek field, no cheek-volume / eye-bag targets; brow: forehead-nubian-decr, brows moved back and snapped flat onto the skin, thinner (eyebrow001 F); F lips lighter; M lips thinner, leaner face. Eye targets now 0.205 / 0.195 of head width

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.736 | 1.62 | 1.45 | 2.083 | 2.05 | 0.41 | 2 |
| waist_w_over_head_h | 0.996 | 1.0 | 0.07 | 1.207 | 1.25 | 0.72 | 2 |
| hip_w_over_head_h | 1.491 | 1.5 | 0.11 | 1.634 | 1.42 | 2.67 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.385 | 0.35 | 1.17 | 0.495 | 0.5 | 0.17 | 1 |
| neck_len_over_head_h | 0.571 | 0.36 | 5.27 | 0.492 | 0.32 | 4.3 | 1 |
| hand_len_over_head_h | 0.8 | 0.76 | 0.8 | 0.979 | 0.8 | 3.58 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.14 | 0.135 | 0.33 | 3 |
| eye_h_over_w | 0.262 | 0.38 | 2.95 | 0.256 | 0.36 | 2.6 | 3 |
| eye_tilt_deg | 7.271 | 9 | 0.58 | 4.178 | 5 | 0.27 | 2 |
| iris_d_over_eye_w | 0.551 | 0.45 | 2.53 | 0.559 | 0.45 | 2.73 | 2 |
| inter_over_eye_w | 1.055 | 1.0 | 0.69 | 1.253 | 1.0 | 3.16 | 1 |
| nose_w_over_face_w | 0.283 | 0.22 | 2.52 | 0.267 | 0.26 | 0.28 | 2 |
| nose_len_over_head_h | 0.265 | 0.22 | 1.8 | 0.288 | 0.23 | 2.32 | 1 |
| mouth_w_over_face_w | 0.457 | 0.46 | 0.1 | 0.456 | 0.46 | 0.13 | 3 |
| mouth_w_over_nose_w | 1.613 | >=1.8 | 1.87 | 1.71 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.357 | 0.3 | 1.42 | 0.355 | 0.25 | 2.62 | 3 |
| lip_h_over_head_h | 0.1 | 0.097 | 0.25 | 0.101 | 0.08 | 1.75 | 2 |
| chin_w_over_face_w | 0.668 | 0.3 | 7.36 | 0.774 | 0.4 | 7.48 | 2 |
| ear_h_over_head_h | 0.228 | 0.2 | 1.4 | 0.252 | 0.21 | 2.1 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.462 | 0.52 | 1.93 | 0.46 | 0.51 | 1.67 | 1 |
| eyeball_d_over_eye_w | 1.225 | 1.12 | 1.75 | 1.242 | 1.12 | 2.03 | 1 |
| **weighted mean g (body/face rows)** | | | **1.269** | | | **1.679** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.366 | 0.39 | 1.2 | 0.362 | 0.4 | 1.9 | 2 |
| eye_line | 0.462 | 0.53 | 4.53 | 0.46 | 0.52 | 4.0 | 3 |
| eye_between_brow_and_nose | 0.26 | 0.45 | 3.8 | 0.25 | 0.39 | 2.8 | 1 |
| nose_tip | 0.608 | 0.64 | 1.6 | 0.64 | 0.66 | 1.0 | 1 |
| nose_base | 0.736 | 0.7 | 2.4 | 0.752 | 0.71 | 2.8 | 3 |
| mouth_line | 0.788 | 0.81 | 1.47 | 0.796 | 0.81 | 0.93 | 3 |
| lip_top | 0.736 | 0.769 | 2.75 | 0.752 | 0.776 | 2.0 | 2 |
| lip_bottom | 0.836 | 0.866 | 2.5 | 0.853 | 0.856 | 0.25 | 2 |
| lower_over_middle_third | 0.713 | 0.97 | 4.28 | 0.635 | 0.94 | 5.08 | 3 |
| ear_top | 0.442 | 0.46 | 0.9 | 0.413 | 0.45 | 1.85 | 2 |
| ear_bottom | 0.67 | 0.66 | 0.5 | 0.665 | 0.66 | 0.25 | 2 |
| ear_h | 0.228 | 0.2 | 1.4 | 0.252 | 0.21 | 2.1 | 3 |
| ear_front_depth | 0.527 | 0.52 | 0.18 | 0.51 | 0.52 | 0.25 | 2 |
| ear_tilt_deg | 15.903 | 12 | 0.78 | 10.814 | 12 | 0.24 | 1 |
| head_w_over_h | 0.746 | 0.7 | 1.53 | 0.744 | 0.7 | 1.47 | 2 |
| head_depth_over_h | 0.957 | 0.86 | 3.23 | 1.041 | 0.88 | 5.37 | 2 |
| eye_w_over_head_w | 0.193 | 0.205 | 0.6 | 0.188 | 0.195 | 0.35 | 2 |
| gap_over_head_w | 0.204 | 0.205 | 0.04 | 0.236 | 0.195 | 1.64 | 1 |
| nose_w_over_head_w | 0.233 | 0.21 | 0.92 | 0.224 | 0.25 | 1.04 | 2 |
| mouth_w_over_head_w | 0.376 | 0.44 | 2.13 | 0.382 | 0.44 | 1.93 | 3 |
| mouth_w_over_pupil | 0.952 | 0.85 | 1.27 | 0.913 | 0.85 | 0.79 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.971** | | | **2.01** | |

### MakeHuman base, round 13: round 12 moved every Loomis line (forehead-nubian-decr shortens the cranium, so the head-size solve enlarged the head): replaced by our brow_flatten field (brow ridge 1.8 mm back); eyes slightly larger (field 1.08), M eyes closer; cheek smoothing Taubin, jaw/chin protected

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.088 | 2.05 | 0.48 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.21 | 1.25 | 0.67 | 2 |
| hip_w_over_head_h | 1.495 | 1.5 | 0.06 | 1.638 | 1.42 | 2.72 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.359 | 0.35 | 0.3 | 0.465 | 0.5 | 1.17 | 1 |
| neck_len_over_head_h | 0.564 | 0.36 | 5.1 | 0.485 | 0.32 | 4.12 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.981 | 0.8 | 3.62 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.14 | 0.143 | 0.2 | 0.137 | 0.135 | 0.13 | 3 |
| eye_h_over_w | 0.256 | 0.38 | 3.1 | 0.262 | 0.36 | 2.45 | 3 |
| eye_tilt_deg | 6.667 | 9 | 0.78 | 4.528 | 5 | 0.16 | 2 |
| iris_d_over_eye_w | 0.542 | 0.45 | 2.3 | 0.549 | 0.45 | 2.48 | 2 |
| inter_over_eye_w | 0.955 | 1.0 | 0.56 | 1.047 | 1.0 | 0.59 | 1 |
| nose_w_over_face_w | 0.274 | 0.22 | 2.16 | 0.259 | 0.26 | 0.04 | 2 |
| nose_len_over_head_h | 0.244 | 0.22 | 0.96 | 0.265 | 0.23 | 1.4 | 1 |
| mouth_w_over_face_w | 0.462 | 0.46 | 0.07 | 0.461 | 0.46 | 0.03 | 3 |
| mouth_w_over_nose_w | 1.686 | >=1.8 | 1.14 | 1.777 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.344 | 0.3 | 1.1 | 0.342 | 0.25 | 2.3 | 3 |
| lip_h_over_head_h | 0.093 | 0.097 | 0.33 | 0.094 | 0.08 | 1.17 | 2 |
| chin_w_over_face_w | 0.712 | 0.3 | 8.24 | 0.753 | 0.4 | 7.06 | 2 |
| ear_h_over_head_h | 0.21 | 0.2 | 0.5 | 0.234 | 0.21 | 1.2 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.504 | 0.52 | 0.53 | 0.5 | 0.51 | 0.33 | 1 |
| eyeball_d_over_eye_w | 1.205 | 1.12 | 1.42 | 1.22 | 1.12 | 1.67 | 1 |
| **weighted mean g (body/face rows)** | | | **1.138** | | | **1.446** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.414 | 0.39 | 1.2 | 0.407 | 0.4 | 0.35 | 2 |
| eye_line | 0.504 | 0.53 | 1.73 | 0.5 | 0.52 | 1.33 | 3 |
| eye_between_brow_and_nose | 0.263 | 0.45 | 3.74 | 0.257 | 0.39 | 2.66 | 1 |
| nose_tip | 0.638 | 0.64 | 0.1 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.757 | 0.7 | 3.8 | 0.77 | 0.71 | 4.0 | 3 |
| mouth_line | 0.805 | 0.81 | 0.33 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.757 | 0.769 | 1.0 | 0.77 | 0.776 | 0.5 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.864 | 0.856 | 0.67 | 2 |
| lower_over_middle_third | 0.709 | 0.97 | 4.35 | 0.632 | 0.94 | 5.13 | 3 |
| ear_top | 0.486 | 0.46 | 1.3 | 0.456 | 0.45 | 0.3 | 2 |
| ear_bottom | 0.696 | 0.66 | 1.8 | 0.689 | 0.66 | 1.45 | 2 |
| ear_h | 0.21 | 0.2 | 0.5 | 0.234 | 0.21 | 1.2 | 3 |
| ear_front_depth | 0.515 | 0.52 | 0.13 | 0.507 | 0.52 | 0.33 | 2 |
| ear_tilt_deg | 15.903 | 12 | 0.78 | 10.814 | 12 | 0.24 | 1 |
| head_w_over_h | 0.688 | 0.7 | 0.4 | 0.69 | 0.7 | 0.33 | 2 |
| head_depth_over_h | 0.903 | 0.86 | 1.43 | 0.971 | 0.88 | 3.03 | 2 |
| eye_w_over_head_w | 0.203 | 0.205 | 0.1 | 0.199 | 0.195 | 0.2 | 2 |
| gap_over_head_w | 0.194 | 0.205 | 0.44 | 0.208 | 0.195 | 0.52 | 1 |
| nose_w_over_head_w | 0.233 | 0.21 | 0.92 | 0.224 | 0.25 | 1.04 | 2 |
| mouth_w_over_head_w | 0.393 | 0.44 | 1.57 | 0.397 | 0.44 | 1.43 | 3 |
| mouth_w_over_pupil | 0.993 | 0.85 | 1.79 | 0.993 | 0.85 | 1.79 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.463** | | | **1.428** | |

### MakeHuman base, round 14: lash ribbon starts 18% in from the inner corner (no dark speck), thinner M lips; base rebuilt with the ribbon as Part_Lashes and snapped brows; Eye_Spacing / Mouth_Narrow keys scaled into range

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.2 | 8.2 | 0.0 | 8.0 | 8.0 | 0.0 | 3 |
| shoulder_w_over_head_h | 1.741 | 1.62 | 1.51 | 2.088 | 2.05 | 0.48 | 2 |
| waist_w_over_head_h | 0.999 | 1.0 | 0.02 | 1.21 | 1.25 | 0.67 | 2 |
| hip_w_over_head_h | 1.495 | 1.5 | 0.06 | 1.638 | 1.42 | 2.72 | 2 |
| waist_over_hip | 0.668 | 0.667 | 0.03 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.359 | 0.35 | 0.3 | 0.465 | 0.5 | 1.17 | 1 |
| neck_len_over_head_h | 0.564 | 0.36 | 5.1 | 0.485 | 0.32 | 4.12 | 1 |
| hand_len_over_head_h | 0.802 | 0.76 | 0.84 | 0.981 | 0.8 | 3.62 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.14 | 0.143 | 0.2 | 0.137 | 0.135 | 0.13 | 3 |
| eye_h_over_w | 0.256 | 0.38 | 3.1 | 0.262 | 0.36 | 2.45 | 3 |
| eye_tilt_deg | 6.667 | 9 | 0.78 | 4.528 | 5 | 0.16 | 2 |
| iris_d_over_eye_w | 0.542 | 0.45 | 2.3 | 0.549 | 0.45 | 2.48 | 2 |
| inter_over_eye_w | 0.955 | 1.0 | 0.56 | 1.047 | 1.0 | 0.59 | 1 |
| nose_w_over_face_w | 0.274 | 0.22 | 2.16 | 0.259 | 0.26 | 0.04 | 2 |
| nose_len_over_head_h | 0.244 | 0.22 | 0.96 | 0.267 | 0.23 | 1.48 | 1 |
| mouth_w_over_face_w | 0.462 | 0.46 | 0.07 | 0.461 | 0.46 | 0.03 | 3 |
| mouth_w_over_nose_w | 1.686 | >=1.8 | 1.14 | 1.777 | >=1.6 | 0.0 | 2 |
| lip_h_over_mouth_w | 0.344 | 0.3 | 1.1 | 0.331 | 0.25 | 2.03 | 3 |
| lip_h_over_head_h | 0.093 | 0.097 | 0.33 | 0.091 | 0.08 | 0.92 | 2 |
| chin_w_over_face_w | 0.712 | 0.3 | 8.24 | 0.753 | 0.4 | 7.06 | 2 |
| ear_h_over_head_h | 0.21 | 0.2 | 0.5 | 0.234 | 0.21 | 1.2 | 3 |
| ear_stickout_over_head_w | 0.031 | 0.03 | 0.05 | 0.031 | 0.04 | 0.45 | 3 |
| eye_line_from_top | 0.504 | 0.52 | 0.53 | 0.5 | 0.51 | 0.33 | 1 |
| eyeball_d_over_eye_w | 1.205 | 1.12 | 1.42 | 1.22 | 1.12 | 1.67 | 1 |
| **weighted mean g (body/face rows)** | | | **1.138** | | | **1.422** | |

| Loomis row | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| brow_line | 0.414 | 0.39 | 1.2 | 0.407 | 0.4 | 0.35 | 2 |
| eye_line | 0.504 | 0.53 | 1.73 | 0.5 | 0.52 | 1.33 | 3 |
| eye_between_brow_and_nose | 0.263 | 0.45 | 3.74 | 0.256 | 0.39 | 2.68 | 1 |
| nose_tip | 0.638 | 0.64 | 0.1 | 0.666 | 0.66 | 0.3 | 1 |
| nose_base | 0.757 | 0.7 | 3.8 | 0.772 | 0.71 | 4.13 | 3 |
| mouth_line | 0.805 | 0.81 | 0.33 | 0.811 | 0.81 | 0.07 | 3 |
| lip_top | 0.757 | 0.769 | 1.0 | 0.772 | 0.776 | 0.33 | 2 |
| lip_bottom | 0.85 | 0.866 | 1.33 | 0.863 | 0.856 | 0.58 | 2 |
| lower_over_middle_third | 0.709 | 0.97 | 4.35 | 0.622 | 0.94 | 5.3 | 3 |
| ear_top | 0.486 | 0.46 | 1.3 | 0.456 | 0.45 | 0.3 | 2 |
| ear_bottom | 0.696 | 0.66 | 1.8 | 0.689 | 0.66 | 1.45 | 2 |
| ear_h | 0.21 | 0.2 | 0.5 | 0.234 | 0.21 | 1.2 | 3 |
| ear_front_depth | 0.515 | 0.52 | 0.13 | 0.507 | 0.52 | 0.33 | 2 |
| ear_tilt_deg | 15.903 | 12 | 0.78 | 10.814 | 12 | 0.24 | 1 |
| head_w_over_h | 0.688 | 0.7 | 0.4 | 0.69 | 0.7 | 0.33 | 2 |
| head_depth_over_h | 0.903 | 0.86 | 1.43 | 0.971 | 0.88 | 3.03 | 2 |
| eye_w_over_head_w | 0.203 | 0.205 | 0.1 | 0.199 | 0.195 | 0.2 | 2 |
| gap_over_head_w | 0.194 | 0.205 | 0.44 | 0.208 | 0.195 | 0.52 | 1 |
| nose_w_over_head_w | 0.233 | 0.21 | 0.92 | 0.224 | 0.25 | 1.04 | 2 |
| mouth_w_over_head_w | 0.393 | 0.44 | 1.57 | 0.397 | 0.44 | 1.43 | 3 |
| mouth_w_over_pupil | 0.993 | 0.85 | 1.79 | 0.993 | 0.85 | 1.79 | 1 |
| **weighted mean g (Loomis rows)** | | | **1.463** | | | **1.437** | |

### MakeHuman base: user feedback on the checkpoint, rounds 12-14 (2026-11-17)
User: "eyes are still way too wide and they look like frog eyes and the cheeks are weird and the brow feels like it is popping
out". New targets: eye opening 0.205 (F) / 0.195 (M) of head width, gap one eye width (`compare_targets.json` `_gate2`, g9 11.4,
g8). Changes:
- Eyes: MakeHuman eye-scale 0.9-1.0 with our field only 1.08 (was 1.25), eye-trans-in (F 0.4, M 0.8) instead of trans-out,
  whole eye region 1.5 mm back, lids 3.5 / 3.0 degrees over the iris, iris texture 1.12x (was 1.32). Strand lash cards replaced by
  our solid lash ribbon (`mh/face_cards.py`, rooted on MakeHuman's upper lash helper line, widening to the outer corner, small
  flick) plus a liner decal moved onto the lid (it had been painted on the eye, so only the flick showed).
- Cheeks: cheek-volume and eye-bag targets removed; a Taubin-smoothed cheek field from under the eye to above the mouth line.
- Brow: our `brow_flatten` field (brow ridge 1.8 mm back). Round 12 had used MakeHuman's forehead-nubian-decr, which also
  shortens the cranium: the head-size solve then enlarged the whole head and moved every Loomis line (eye line 0.46);
  replaced in round 13. Brows: eyebrow001 (F) / eyebrow008 (M), snapped flat onto the skin.
- Lips: F upper lip volume 0.1, lower lip -0.2, mouth slightly narrower; M lips thinner and less tall.
- Keys: `Eye_Spacing` and `Mouth_Narrow` scaled into range; the halfling's neck-to-shoulder transition relaxed (no folds).

Round 14 (latest): weighted mean g body/face F 1.14 / M 1.42, Loomis F 1.46 / M 1.44; eye width 0.20 / 0.20 of head width,
gap 0.19 / 0.21. Key ranges (`mh/export/key_ranges.json`): eye 0.20-0.23, gap 0.19-0.25, mouth 0.37-0.46, ears 0.20-0.23.
By eye (`mh/mh_round14_features.png`, `mh/checkpoint_*.png`): the eyes are no longer wide, bulging or frog-like; they read as
normal almond eyes with a dark lash line and flick. Cheeks are smooth, brows lie flat. Weak: the feminine face now reads more
realistic and plainer than the reference (smaller eyes was the user's call); the masculine face is still broad and soft with
full lips; the liner is thinner than the reference's bold wing; lip colour is still a vertex tint.

### MakeHuman base, round 15: RESET of every mouth / neck / chin edit (user: lips sausage-like, neck a slope): MakeHuman's own neutral mouth and neck; scored against measured anthropometry (Farkas) instead of Loomis; subnasale = deepest corner of the profile between nose tip and upper lip

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.449 | 0.35 | 3.3 | 0.609 | 0.5 | 3.63 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.136 | 0.135 | 0.07 | 3 |
| eye_h_over_w | 0.263 | 0.38 | 2.92 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 6.851 | 9 | 0.72 | 3.836 | 5 | 0.39 | 2 |
| iris_d_over_eye_w | 0.539 | 0.45 | 2.23 | 0.543 | 0.45 | 2.33 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.042 | 1.0 | 0.53 | 1 |
| nose_w_over_face_w | 0.264 | 0.22 | 1.76 | 0.268 | 0.26 | 0.32 | 2 |
| nose_len_over_head_h | 0.154 | 0.22 | 2.64 | 0.212 | 0.23 | 0.72 | 1 |
| mouth_w_over_face_w | 0.409 | 0.46 | 1.7 | 0.427 | 0.46 | 1.1 | 3 |
| mouth_w_over_nose_w | 1.548 | >=1.8 | 2.52 | 1.593 | >=1.6 | 0.07 | 2 |
| lip_h_over_mouth_w | 0.491 | 0.3 | 4.78 | 0.446 | 0.25 | 4.9 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.113 | 0.08 | 2.75 | 2 |
| chin_w_over_face_w | 0.67 | 0.3 | 7.4 | 0.671 | 0.4 | 5.42 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.228 | 0.21 | 0.9 | 3 |
| ear_stickout_over_head_w | 0.029 | 0.03 | 0.05 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.514 | 0.52 | 0.2 | 0.481 | 0.51 | 0.97 | 1 |
| eyeball_d_over_eye_w | 1.197 | 1.12 | 1.28 | 1.206 | 1.12 | 1.43 | 1 |
| **weighted mean g (body/face rows)** | | | **1.585** | | | **1.692** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.415 | 1.27 | 1.45 | 1.142 | 1.32 | 1.78 | 3 |
| upper_over_middle | 1.305 | 1.25 | 0.46 | 1.119 | 1.22 | 0.84 | 1 |
| eye_len_over_gap | 1.058 | 0.97 | 1.1 | 0.96 | 0.94 | 0.25 | 2 |
| nose_w_over_gap | 1.165 | 0.99 | 1.75 | 1.121 | 1.05 | 0.71 | 2 |
| mouth_over_nose_w | 1.548 | 1.6 | 0.35 | 1.593 | 1.55 | 0.29 | 2 |
| mouth_over_pupil | 0.881 | 0.85 | 0.39 | 0.93 | 0.85 | 1.0 | 2 |
| mouth_line_in_lower | 0.378 | 0.33 | 0.96 | 0.295 | 0.33 | 0.7 | 2 |
| upper_lip_over_lower_lip | 0.739 | 0.62 | 0.99 | 0.624 | 0.62 | 0.03 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.475 | 1.45 | 0.25 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.204 | 0.205 | 0.05 | 0.201 | 0.195 | 0.3 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **0.825** | | | **0.69** | |

### MakeHuman base, round 16: Stylise (local) keys; anthropometry scoring; lips/neck from MakeHuman's own neutral with small MakeHuman targets; male face (jaw, cheekbones, thinner lips, natural painted brows); old faces smoothed; head depth; variation sliders with 1 = 2 SD; scale-only key transport (no neck shear)

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.404 | 0.35 | 1.8 | 0.558 | 0.5 | 1.93 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.136 | 0.135 | 0.07 | 3 |
| eye_h_over_w | 0.263 | 0.38 | 2.92 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 6.851 | 9 | 0.72 | 3.836 | 5 | 0.39 | 2 |
| iris_d_over_eye_w | 0.539 | 0.45 | 2.23 | 0.542 | 0.45 | 2.3 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.041 | 1.0 | 0.51 | 1 |
| nose_w_over_face_w | 0.264 | 0.22 | 1.76 | 0.276 | 0.26 | 0.64 | 2 |
| nose_len_over_head_h | 0.154 | 0.22 | 2.64 | 0.202 | 0.23 | 1.12 | 1 |
| mouth_w_over_face_w | 0.409 | 0.46 | 1.7 | 0.427 | 0.46 | 1.1 | 3 |
| mouth_w_over_nose_w | 1.549 | >=1.8 | 2.51 | 1.55 | >=1.6 | 0.5 | 2 |
| lip_h_over_mouth_w | 0.491 | 0.3 | 4.78 | 0.449 | 0.25 | 4.98 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.114 | 0.08 | 2.83 | 2 |
| chin_w_over_face_w | 0.67 | 0.3 | 7.4 | 0.755 | 0.4 | 7.1 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.029 | 0.03 | 0.05 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.514 | 0.52 | 0.2 | 0.48 | 0.51 | 1.0 | 1 |
| eyeball_d_over_eye_w | 1.197 | 1.12 | 1.28 | 1.205 | 1.12 | 1.42 | 1 |
| **weighted mean g (body/face rows)** | | | **1.556** | | | **1.768** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.415 | 1.27 | 1.45 | 1.227 | 1.32 | 0.93 | 3 |
| upper_over_middle | 1.305 | 1.25 | 0.46 | 1.163 | 1.22 | 0.47 | 1 |
| eye_len_over_gap | 1.058 | 0.97 | 1.1 | 0.961 | 0.94 | 0.26 | 2 |
| nose_w_over_gap | 1.164 | 0.99 | 1.74 | 1.152 | 1.05 | 1.02 | 2 |
| mouth_over_nose_w | 1.549 | 1.6 | 0.34 | 1.55 | 1.55 | 0.0 | 2 |
| mouth_over_pupil | 0.881 | 0.85 | 0.39 | 0.93 | 0.85 | 1.0 | 2 |
| mouth_line_in_lower | 0.383 | 0.33 | 1.06 | 0.317 | 0.33 | 0.26 | 2 |
| upper_lip_over_lower_lip | 0.779 | 0.62 | 1.33 | 0.635 | 0.62 | 0.13 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.476 | 1.45 | 0.26 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.204 | 0.205 | 0.05 | 0.201 | 0.195 | 0.3 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **0.863** | | | **0.53** | |

## Stylise (local), measured proportions, lips/neck reset, sliders and editor (2026-11-21, rounds 15-16)

TRELLIS.2 / FLUX were stopped at the user's request (ZeroGPU quota too small); nothing from them is used or credited.
The four FLUX schnell test images in `art/models3d/out/design/` were left in place untouched, as asked.

- **Proportions:** the Loomis targets are dropped (history only, see g9 §11). Scoring now uses measured anthropometry
  (Farkas 2005; Al-Sebaei 2015 for how often the canons fail): `compare_targets.json` group `anthro`, overlay
  `mh/anthro_mh_round16_sheet.png`.
- **Lips and neck:** every custom mouth / neck / chin edit was removed (old recipe kept as `mh/recipe_round14.json`). The
  base is now MakeHuman's own neutral plus small MakeHuman targets only: cupid's bow, philtrum, lower lip, depth; for the man
  thinner lips, chin, neck. Throat angle: F 113°, M 110° (MakeHuman plain: 113° / 116°). Proof: `mh/lips_neck.png`.
- **Stylise:** `Stylise_F` / `Stylise_M` blend shapes from `stylise_local.py`. These are large soft fields (cheeks, crown,
  temples, nose width; for the man cheekbones and jaw) with the lid rims, inner mouth, nostril rims and ears protected.
  The effect is deliberately mild.
- **Face texture:** `mh/export/textures/face_paint_{f,m}.png` (liner and wing, crease, soft painted brows) and
  `face_tint_{f,m}.png` (subtle lip tint darker at the line and corners, blush), baked on FaceDecalUV through front faces
  only.
- **Man:** a defined jaw (MakeHuman chin-bones, head-square, cheek-inner), cheekbones, a slimmer nose, thinner and
  natural-coloured lips, natural darker brows (card plus painted brow).
- **Round-14 issues:**
  - `Age_Old` has its head displacement low-passed (fewer fine wrinkles).
  - The back of the skull is shallower (head-depth gap).
  - The orc neck is thinner.
  - The feminine lips no longer jut.
- **Sliders:** 26 face and 11 body sliders, bipolar -1..+1 (1 = about 2 SD), with 8 new `Var_*` keys and old keys rescaled.
  Generator: `person.generate`. A `Fix_EyeRound_Blink_L/R` corrective makes blink close in every combination
  (`mh/blink_check.json`: 28/28 closed). Local keys are now carried through the warp by its local scale only, which removed
  the neck shear that chin and lower-face keys used to cause.
- **Editor:** `mh/open_editor.sh`, `mh/editor.blend`, `mh/editor_panel.py`, `mh/EDITING.md` (screenshot
  `mh/editor_panel.png`). Headless test `mh/test_editor.py`: 11/11 pass.

Round 16 anthropometry weighted mean g: F 0.86, M 0.53 (lower/middle F 1.42 vs 1.27; M 1.23 after the chin fix).

Weak spots, by eye:
- Faces read realistic and plain more than stylised. With the lips and neck back on MakeHuman's own neutral and Stylise kept
  mild, the animated-film look is mostly gone.
- The man is better (jaw, brows) but still slightly soft through the mid-cheek.
- `Lower face length` -1 / +1 still shows a small crease under the jaw in extreme sweeps.
- The halfling's adult neck on the smaller body still folds a little at the shoulders.
- The orc reads heavy-faced.
- The 70-year-olds read only mildly older.

### MakeHuman base, round 17: WOMAN round: lash ribbon rooted on the anterior lid margin (follows blink), thickest in the outer third, wing continuing the lash line, lower lashes; liner decal on the lid; caruncle tint, eye AO; lip gloss (FaceMask R); eyebrow sliders and 8 styles

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.404 | 0.35 | 1.8 | 0.558 | 0.5 | 1.93 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.136 | 0.135 | 0.07 | 3 |
| eye_h_over_w | 0.263 | 0.38 | 2.92 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 6.851 | 9 | 0.72 | 3.836 | 5 | 0.39 | 2 |
| iris_d_over_eye_w | 0.539 | 0.45 | 2.23 | 0.542 | 0.45 | 2.3 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.041 | 1.0 | 0.51 | 1 |
| nose_w_over_face_w | 0.264 | 0.22 | 1.76 | 0.276 | 0.26 | 0.64 | 2 |
| nose_len_over_head_h | 0.154 | 0.22 | 2.64 | 0.202 | 0.23 | 1.12 | 1 |
| mouth_w_over_face_w | 0.409 | 0.46 | 1.7 | 0.427 | 0.46 | 1.1 | 3 |
| mouth_w_over_nose_w | 1.549 | >=1.8 | 2.51 | 1.55 | >=1.6 | 0.5 | 2 |
| lip_h_over_mouth_w | 0.491 | 0.3 | 4.78 | 0.449 | 0.25 | 4.98 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.114 | 0.08 | 2.83 | 2 |
| chin_w_over_face_w | 0.67 | 0.3 | 7.4 | 0.755 | 0.4 | 7.1 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.029 | 0.03 | 0.05 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.514 | 0.52 | 0.2 | 0.48 | 0.51 | 1.0 | 1 |
| eyeball_d_over_eye_w | 1.197 | 1.12 | 1.28 | 1.205 | 1.12 | 1.42 | 1 |
| **weighted mean g (body/face rows)** | | | **1.556** | | | **1.768** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.415 | 1.27 | 1.45 | 1.227 | 1.32 | 0.93 | 3 |
| upper_over_middle | 1.305 | 1.25 | 0.46 | 1.163 | 1.22 | 0.47 | 1 |
| eye_len_over_gap | 1.058 | 0.97 | 1.1 | 0.961 | 0.94 | 0.26 | 2 |
| nose_w_over_gap | 1.164 | 0.99 | 1.74 | 1.152 | 1.05 | 1.02 | 2 |
| mouth_over_nose_w | 1.549 | 1.6 | 0.34 | 1.55 | 1.55 | 0.0 | 2 |
| mouth_over_pupil | 0.881 | 0.85 | 0.39 | 0.93 | 0.85 | 1.0 | 2 |
| mouth_line_in_lower | 0.383 | 0.33 | 1.06 | 0.317 | 0.33 | 0.26 | 2 |
| upper_lip_over_lower_lip | 0.779 | 0.62 | 1.33 | 0.635 | 0.62 | 0.13 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.476 | 1.45 | 0.26 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.204 | 0.205 | 0.05 | 0.201 | 0.195 | 0.3 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **0.863** | | | **0.53** | |

### Round 17 (woman only, 2026-11-21): lashes, eye corners, lip gloss, eyebrow sliders
User: lashes placed weirdly, eye corners a bit wrong, lips not glossy, eyebrows should differ per person.

What changed:
- **Lashes.** The lash ribbon is now rooted on the anterior upper lid margin: fixed hm08 vertices found from the visible
  eye opening, so the ribbon hugs the lid and follows Blink and every key. It tapers to nothing at the inner corner, is
  thickest in the outer third and sweeps forward-up. A wing continues the lash line from the outer corner. Short lower
  lashes run along the outer half of the lower lid.
- **Liner decal.** Moved onto the lid, so the decal wing and the ribbon wing meet.
- **Eye corners and lids.** A pink caruncle tint at the inner corners, and an ambient-occlusion shadow from the lids on the
  eyeball.
- **Lip gloss.** `FaceMask` R channel; roughness 0.52 -> 0.28, more specular, clear coat 0.3. Baked to
  `face_mask_{f,m}.png`. Lip colour is slightly richer.
- **Eyebrows.** Seven sliders (`Brow_*` keys on `Part_Brows`), density and colour as material parameters, and 8 styles
  that `person.generate` picks between and varies around. The panel has a new "Eyebrows" group.

Checks:
- `verify_mh.py`: OK, 94 shape keys.
- `test_editor.py`: 11/11.
- Blink closes in all 28 risky combinations.
- Anthropometry rows unchanged (F 0.86).

Images, all in `mh/`:
- Eye close-ups and blink sequence: `f_eyes_closeup.png`
- Lips with gloss: `f_lips_gloss.png`
- Brow sweeps and styles: `f_brow_sweeps.png`, `f_brow_styles.png`
- Eight generated women: `f_generated_8.png`
- Features crop and checkpoint: `mh_round17_features.png`, `checkpoint_neutral.png`

Weak spots:
- The inner corner still shows the eyeball's white running to a fairly blunt end. The caruncle tint sits on skin and
  barely shows; a real tear duct needs geometry or eye-texture work.
- The upper lid margin is still visible as a thin light strip in some angles.
- Brow styles use one texture (the other MakeHuman brow textures have different card UVs), so styles differ in shape and
  density, not in hair pattern.
- The brow sliders are subtle at 3/4 game distance.
- The gloss reads strongly on dark skin in the generated sheet.

### MakeHuman base, round 18: WOMAN round 18: lashes rebuilt as curved strips on the lid margin (strands perpendicular to the lid, length short at both corners, no 3D wing), tear-duct part, sclera corner shading, lid-rim tint, closed-lid fix, crease, tone-based lip colour and gloss, narrower generated lips, relaxed expression, 4 new brow textures, wider brow sliders

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.404 | 0.35 | 1.8 | 0.558 | 0.5 | 1.93 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.136 | 0.135 | 0.07 | 3 |
| eye_h_over_w | 0.263 | 0.38 | 2.92 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 6.851 | 9 | 0.72 | 3.836 | 5 | 0.39 | 2 |
| iris_d_over_eye_w | 0.539 | 0.45 | 2.23 | 0.542 | 0.45 | 2.3 | 2 |
| inter_over_eye_w | 0.945 | 1.0 | 0.69 | 1.041 | 1.0 | 0.51 | 1 |
| nose_w_over_face_w | 0.264 | 0.22 | 1.76 | 0.276 | 0.26 | 0.64 | 2 |
| nose_len_over_head_h | 0.154 | 0.22 | 2.64 | 0.202 | 0.23 | 1.12 | 1 |
| mouth_w_over_face_w | 0.409 | 0.46 | 1.7 | 0.427 | 0.46 | 1.1 | 3 |
| mouth_w_over_nose_w | 1.549 | >=1.8 | 2.51 | 1.55 | >=1.6 | 0.5 | 2 |
| lip_h_over_mouth_w | 0.491 | 0.3 | 4.78 | 0.449 | 0.25 | 4.98 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.114 | 0.08 | 2.83 | 2 |
| chin_w_over_face_w | 0.67 | 0.3 | 7.4 | 0.755 | 0.4 | 7.1 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.029 | 0.03 | 0.05 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.514 | 0.52 | 0.2 | 0.48 | 0.51 | 1.0 | 1 |
| eyeball_d_over_eye_w | 1.197 | 1.12 | 1.28 | 1.205 | 1.12 | 1.42 | 1 |
| **weighted mean g (body/face rows)** | | | **1.556** | | | **1.768** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.415 | 1.27 | 1.45 | 1.227 | 1.32 | 0.93 | 3 |
| upper_over_middle | 1.305 | 1.25 | 0.46 | 1.163 | 1.22 | 0.47 | 1 |
| eye_len_over_gap | 1.058 | 0.97 | 1.1 | 0.961 | 0.94 | 0.26 | 2 |
| nose_w_over_gap | 1.164 | 0.99 | 1.74 | 1.152 | 1.05 | 1.02 | 2 |
| mouth_over_nose_w | 1.549 | 1.6 | 0.34 | 1.55 | 1.55 | 0.0 | 2 |
| mouth_over_pupil | 0.881 | 0.85 | 0.39 | 0.93 | 0.85 | 1.0 | 2 |
| mouth_line_in_lower | 0.383 | 0.33 | 1.06 | 0.317 | 0.33 | 0.26 | 2 |
| upper_lip_over_lower_lip | 0.779 | 0.62 | 1.33 | 0.635 | 0.62 | 0.13 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.476 | 1.45 | 0.26 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.204 | 0.205 | 0.05 | 0.201 | 0.195 | 0.3 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **0.863** | | | **0.53** | |

### Round 18 (woman only, 2026-11-21): lashes that follow the lid, tear duct, closed lids, lips by tone, brow textures, friendlier faces

**Lashes** (user: "they stick out"):
- Rebuilt as curved strips of three rows (root, middle, tip), 28 segments, rooted on upper-lid margin vertices that the
  Blink actually moves. Strands go perpendicular to the lid edge and curl away from the eye.
- Length is short at both corners and longest at about 68 % along. There is no 3D wing; the wing exists only as painted
  liner. Lower lashes are short and point down and out.
- Strand alpha texture: `mh/textures/lash_strands.png`.
- `f_lashes.png` shows five views (front, 3/4, side, above, below) at open, half and closed, next to the reference.
- When closed, the lashes rest along the lid line pointing down and forward.
- Lash roots are computed once on the stylised neutral by the build and cached in `mh/cache/lash_roots.json`.

**Inner corner:**
- New `Part_TearDuct`: a pink, wet lens anchored on the inner canthus.
- Eye textures darken and pink towards the corners; lid-rim tint.

**Closed lids:** the pale crescent at the outer corner was a sharp skin fold left by MakeHuman's closure, not the eyeball or
the lashes. A smoothing pass on the closed shape is written but off (`SMOOTH_BLINK`): it did not help, and the real cause
of the broken closed lashes was the root choice. The fix that shipped is a darker tint at the outer canthus. The crescent
is fainter but still there in close 3/4 views.

**Lid crease:** painted crease line at about 1.45 times the lid opening above the lash line. MakeHuman's
eyefold-concave and corner2-down targets were tried and removed, because they opened the eye too round.

**Lips:**
- Generated women: narrower ranges, upper lip about 2/3 of the lower, fuller lips only on larger faces.
- Lip colour and gloss come from skin tone; generated people get 0.75 x gloss (`f_lips_tones.png`).

**Brows:**
- Four new textures on the eyebrow001 layout (fine, bushy, groomed, feathered) mixed into the 8 styles.
- Slider ranges widened about 1.5x. At game distance (`f_brows_game_distance.png`) the changes are still subtle.

**Friendlier faces:**
- Generated women get a relaxed default: mouth corners up 0.22, brows up 0.06, lips held closed.
- Face length, lower face, cheek fullness and brow tilt are capped.

**Checks:** verify OK (21,930 triangles), editor test 11/11, blink 28/28 closed.

**Weak spots:**
- With eyes open, the upper lashes still read thin from the front, because the heavy upper lid hangs over the lid margin.
- A thin white line (teeth) shows between the lips on some generated women.
- Brow sliders are hard to read at game distance.
- The tear duct is small and only visible in close-ups.

### MakeHuman base, round 19: WOMAN round 19: MakeHuman eyelash proxy lengthened and curled (LashProxy) with a clean strand texture; lids opened to anatomy (31 x 10 mm); caruncle at the visible inner corner; brows higher; teeth set back 1.5 mm

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.404 | 0.35 | 1.8 | 0.558 | 0.5 | 1.93 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.144 | 0.143 | 0.07 | 0.136 | 0.135 | 0.07 | 3 |
| eye_h_over_w | 0.317 | 0.38 | 1.57 | 0.264 | 0.36 | 2.4 | 3 |
| eye_tilt_deg | 7.271 | 9 | 0.58 | 3.836 | 5 | 0.39 | 2 |
| iris_d_over_eye_w | 0.538 | 0.45 | 2.2 | 0.542 | 0.45 | 2.3 | 2 |
| inter_over_eye_w | 0.941 | 1.0 | 0.74 | 1.041 | 1.0 | 0.51 | 1 |
| nose_w_over_face_w | 0.264 | 0.22 | 1.76 | 0.276 | 0.26 | 0.64 | 2 |
| nose_len_over_head_h | 0.153 | 0.22 | 2.68 | 0.202 | 0.23 | 1.12 | 1 |
| mouth_w_over_face_w | 0.409 | 0.46 | 1.7 | 0.427 | 0.46 | 1.1 | 3 |
| mouth_w_over_nose_w | 1.549 | >=1.8 | 2.51 | 1.55 | >=1.6 | 0.5 | 2 |
| lip_h_over_mouth_w | 0.491 | 0.3 | 4.78 | 0.449 | 0.25 | 4.98 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.114 | 0.08 | 2.83 | 2 |
| chin_w_over_face_w | 0.67 | 0.3 | 7.4 | 0.755 | 0.4 | 7.1 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.029 | 0.03 | 0.05 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.515 | 0.52 | 0.17 | 0.48 | 0.51 | 1.0 | 1 |
| eyeball_d_over_eye_w | 1.195 | 1.12 | 1.25 | 1.205 | 1.12 | 1.42 | 1 |
| **weighted mean g (body/face rows)** | | | **1.474** | | | **1.768** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.415 | 1.27 | 1.45 | 1.227 | 1.32 | 0.93 | 3 |
| upper_over_middle | 1.305 | 1.25 | 0.46 | 1.163 | 1.22 | 0.47 | 1 |
| eye_len_over_gap | 1.063 | 0.97 | 1.16 | 0.961 | 0.94 | 0.26 | 2 |
| nose_w_over_gap | 1.167 | 0.99 | 1.77 | 1.152 | 1.05 | 1.02 | 2 |
| mouth_over_nose_w | 1.549 | 1.6 | 0.34 | 1.55 | 1.55 | 0.0 | 2 |
| mouth_over_pupil | 0.882 | 0.85 | 0.4 | 0.93 | 0.85 | 1.0 | 2 |
| mouth_line_in_lower | 0.383 | 0.33 | 1.06 | 0.317 | 0.33 | 0.26 | 2 |
| upper_lip_over_lower_lip | 0.779 | 0.62 | 1.33 | 0.635 | 0.62 | 0.13 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.476 | 1.45 | 0.26 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.205 | 0.205 | 0.0 | 0.201 | 0.195 | 0.3 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **0.868** | | | **0.53** | |

### Round 19 (woman only, 2026-11-22): MakeHuman lashes, eyes from anatomy, higher brows, teeth line
**Lashes:**
- MakeHuman's eyelashes02 proxy again (its own fit, it follows the blink), lengthened and curled by `face_cards.LashProxy`.
  Short at the inner corner, longest at about 2/3 along, shorter at the outer corner, tips bent away from the eye.
- Clean strand texture `eyelashes02_clean.png`.
- Front at game distance (`mh/f_lashes_game_distance.png`): the lashes now show as a fringe above the lid.
- Closed: the lashes lie along the lid line, with no forward clump and no stray inner strand.
- The round 17-18 ribbon code is kept but no longer used.

**Eyes, measured against anatomy** (`mh/f_eye_anatomy.json`, scaled to a 216 mm head; target in brackets):

| measure | ours | target |
|---|---|---|
| opening | 31.3 x 10.3 mm, w/h 3.04 | ~30 x 10, 2.8-3.2 |
| tilt | 7.0° | 4-8° |
| iris covered by upper lid | 0.7 mm | 1-2 |
| lower lid above iris bottom | 1.0 mm | ~0 |
| upper-lid peak | 0.6 mm nasal | slightly nasal |
| lower-lid low point | 1.9 mm nasal | should be temporal: **miss** |

- Caruncle (`Part_TearDuct`) moved to the visible inner corner; it now reads at close range.
- The plica is only the pink-darkened sclera at the corners, not a distinct crescent.

**Brows:** the neutral's brows were raised (Brow_Height +1.1, arch +0.4, tail +0.2). The lower edge sits 12.6 mm above the
lash line over the pupil, about 1.2x the opening height; the target is 1.5-2x, so still somewhat low. The guide lines in
`mh/f_brow_placement.png` are misplaced (the nose-wing point is picked wrongly), so that overlay is not usable yet.

**Teeth:** set back 1.5 mm and down 0.8 mm (`OffsetProxy`).

**Checks:** verify OK (21,978 triangles), editor test 11/11, blink 28/28.

### Round 20 (2026-11-22): eyes back to MakeHuman, anatomy lids, brows, lips, teeth; man re-checked
Eye region reset: our eye-scale field and every custom eye target were removed. What remains is MakeHuman `eye-scale-incr`
(F 1.7, M 1.5) and `eye-corner1-up` (F 1.0), plus one smooth lid field per sex. That field turns the upper lid down over
the iris (F 7°, M 3°) and turns the lower lid about the eyeball's vertical axis toward the ear (`lower_yaw`, F 14°, M 12°).
Bug fixed: the lid field used to deform the eyeball helper too; it now acts on skin only.

Eye fixes:
- **Textures and surfaces.** MakeHuman's own eye textures, unmodified (`eye_*_mh.png`). Glossy cornea (roughness 0.03,
  IOR 1.38). Warm off-white sclera with no emission, and a 9 mm AO band under the upper lid and in the corners. Tear-line
  gloss on the lower lid margin.
- **Skin around the eyes.** Eyelid soften field: smoother upper lids and under-eye skin.
- **Lashes and liner.** No painted liner or wing. Upper lashes shorter and lighter, lower lashes at 0.3x. The man uses
  MakeHuman eyelashes01, fitted the same way.
- **Corners.** Plica added as a second, flat pink lens next to the caruncle (`Part_TearDuct`).

Also:
- Brows raised: F `Brow_Height` 2.0, M 2.0.
- Lips smaller (upper volume -0.15, lower -0.3, width -0.1); gloss lowered (roughness floor 0.34, coat 0.15).
- Brow overlay now uses the real nose-wing landmark.
- Reference crops removed from the eye sheets.

Measured (`f_eye_anatomy.json`, `m_eye_anatomy.json`; head scaled to 216 mm for women, 232 mm for men):

| measure | woman | man | target |
|---|---|---|---|
| opening | 27.2 x 9.0 mm (3.02) | 25.8 x 9.2 mm (2.82) | ~30 x 10, 2.8-3.2 |
| tilt | 6.3° | 6.0° | 4-8° |
| upper lid over iris | 1.3 mm | 1.4 mm | 1-2 |
| lower lid vs iris bottom | 0.0 mm | -0.1 mm | ~0 |
| upper-lid peak | 1.0 mm nasal | 0.6 mm nasal | slightly nasal |
| lower-lid low point | 1.4 mm temporal | 2.1 mm temporal | slightly temporal |
| brow gap / opening height | 18.0 / 9.0 = 2.0 | 15.8 / 9.2 = 1.7 | 1.5-2 |

Checks: verify OK (21,994 triangles), editor test 11/11 (the test now deletes only the backup it made itself), blink 28/28.

### Round 21 (2026-11-22): eyes = plain MakeHuman (user decision)
Removed for both sexes:
- every MakeHuman eye target, the lid field and the eyelid smoothing;
- our lash lengthening (`LashProxy`) and the clean lash texture;
- the tear duct and plica lenses (no `Part_TearDuct` in the build any more);
- the caruncle, lid-rim and canthus tints, the tear-line gloss;
- the painted liner, crease and shade.

What remains:
- **Eyes.** MakeHuman's eye mesh and its own brown texture, in the same material as the plain row.
- **Lashes.** MakeHuman eyelashes02 (woman) and eyelashes01 (man) with their own .mhclo fit, so they follow the blink.
  Default length, texture and look.
- **Stylise.** The eye protection radius grew to 1.6-2.3 x the eyeball radius, so Stylise_F/M no longer touches the eye
  region.
- **Brows.** Kept from round 20; the painted brow under the cards now follows the raised card.

Open eyes now match the plain row in `mh/f_eyes_closeup.png` and `mh/m_eyes_closeup.png`.

Plain numbers (`*_eye_anatomy.json`):
- Woman: opening 23.6 x 8.6 mm, tilt 6.2°, upper lid over iris 0.7 mm, lower-lid low point 2.5 mm nasal.
- Man: opening 23.5 x 7.5 mm, tilt 2.5°.
These are MakeHuman's own proportions, not adjusted.

Checks: verify OK (21,850 triangles), editor test 11/11, blink 28/28. Recipe backup: `mh/backups/recipe_00000000_before_round21.json`.

### Round 22 (2026-11-22): closed-eye lashes, brow smudge, lips
- **Lashes.** New `face_cards.BlinkLashProxy`. With the eye open it returns the exact MakeHuman fit. When the lid moves,
  the upper lashes turn with the lid about the eyeball's horizontal axis. The angle per lash is the mean turn of its 8
  nearest margin roots, read from the MakeHuman fit itself, and blends in over the first 0.05 rad. Used in the build
  (Part_Lashes blink keys, basis = the open neutral) and in previews (open coordinates passed in). Half-closed and closed
  lashes now lie along the lid in a downward curve with no bunching. The man still shows a little splay at the outer
  corner when fully closed.
- **Brow smudge.** The painted brow under the cards is turned off (`brow_shadow` 0) for both sexes; only the hair cards
  show.
- **Lips.** MakeHuman targets only. Woman: lower lip -0.55, upper -0.3, depth -0.45. Man: lower -0.4, upper -0.35, depth
  -0.45. Gloss lower: roughness floor 0.40, clear coat 0.08.
- **Checks:** verify OK, editor test 11/11, blink 28/28. Backup: `mh/backups/recipe_00000000_before_round22.json`.
- **Sheets:** `mh/f_eyes_closeup.png`, `mh/m_eyes_closeup.png`, `mh/f_lashes_game_distance.png`,
  `mh/m_lashes_game_distance.png`, `mh/f_lips.png`, `mh/m_lips.png`.

### MakeHuman base, round 23: face frozen (round 22); refresh of all sheets

| metric | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| heads_tall | 8.195 | 8.2 | 0.02 | 7.995 | 8.0 | 0.02 | 3 |
| shoulder_w_over_head_h | 1.727 | 1.62 | 1.34 | 2.109 | 2.05 | 0.74 | 2 |
| waist_w_over_head_h | 0.988 | 1.0 | 0.2 | 1.223 | 1.25 | 0.45 | 2 |
| hip_w_over_head_h | 1.482 | 1.5 | 0.23 | 1.654 | 1.42 | 2.92 | 2 |
| waist_over_hip | 0.667 | 0.667 | 0.0 | 0.739 | 0.88 | 3.53 | 3 |
| crotch_over_height | 0.485 | 0.485 | 0.0 | 0.48 | 0.48 | 0.0 | 2 |
| neck_w_over_head_h | 0.404 | 0.35 | 1.8 | 0.558 | 0.5 | 1.93 | 1 |
| neck_len_over_head_h | 0.584 | 0.36 | 5.6 | 0.457 | 0.32 | 3.43 | 1 |
| hand_len_over_head_h | 0.795 | 0.76 | 0.7 | 0.991 | 0.8 | 3.82 | 2 |
| wrist_hang_vs_crotch | 0.023 | 0.0 | 1.53 | -0.004 | 0.0 | 0.27 | 1 |
| eye_w_over_head_h | 0.105 | 0.143 | 2.53 | 0.101 | 0.135 | 2.27 | 3 |
| eye_h_over_w | 0.359 | 0.38 | 0.53 | 0.304 | 0.36 | 1.4 | 3 |
| eye_tilt_deg | 4.876 | 9 | 1.37 | 1.745 | 5 | 1.08 | 2 |
| iris_d_over_eye_w | 0.648 | 0.45 | 4.95 | 0.647 | 0.45 | 4.92 | 2 |
| inter_over_eye_w | 1.723 | 1.0 | 9.04 | 1.929 | 1.0 | 11.61 | 1 |
| nose_w_over_face_w | 0.259 | 0.22 | 1.56 | 0.28 | 0.26 | 0.8 | 2 |
| nose_len_over_head_h | 0.169 | 0.22 | 2.04 | 0.217 | 0.23 | 0.52 | 1 |
| mouth_w_over_face_w | 0.402 | 0.46 | 1.93 | 0.435 | 0.46 | 0.83 | 3 |
| mouth_w_over_nose_w | 1.55 | >=1.8 | 2.5 | 1.55 | >=1.6 | 0.5 | 2 |
| lip_h_over_mouth_w | 0.498 | 0.3 | 4.95 | 0.449 | 0.25 | 4.98 | 3 |
| lip_h_over_head_h | 0.12 | 0.097 | 1.92 | 0.114 | 0.08 | 2.83 | 2 |
| chin_w_over_face_w | 0.669 | 0.3 | 7.38 | 0.769 | 0.4 | 7.38 | 2 |
| ear_h_over_head_h | 0.214 | 0.2 | 0.7 | 0.229 | 0.21 | 0.95 | 3 |
| ear_stickout_over_head_w | 0.03 | 0.03 | 0.0 | 0.03 | 0.04 | 0.5 | 3 |
| eye_line_from_top | 0.504 | 0.52 | 0.53 | 0.469 | 0.51 | 1.37 | 1 |
| eyeball_d_over_eye_w | 1.441 | 1.12 | 5.35 | 1.438 | 1.12 | 5.3 | 1 |
| **weighted mean g (body/face rows)** | | | **1.928** | | | **2.241** | |

| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |
|---|---|---|---|---|---|---|---|
| lower_over_middle | 1.416 | 1.27 | 1.46 | 1.227 | 1.32 | 0.93 | 3 |
| upper_over_middle | 1.306 | 1.25 | 0.47 | 1.163 | 1.22 | 0.47 | 1 |
| eye_len_over_gap | 0.58 | 0.97 | 4.88 | 0.519 | 0.94 | 5.26 | 2 |
| nose_w_over_gap | 0.858 | 0.99 | 1.32 | 0.843 | 1.05 | 2.07 | 2 |
| mouth_over_nose_w | 1.55 | 1.6 | 0.33 | 1.55 | 1.55 | 0.0 | 2 |
| mouth_over_pupil | 0.842 | 0.85 | 0.1 | 0.867 | 0.85 | 0.21 | 2 |
| mouth_line_in_lower | 0.383 | 0.33 | 1.06 | 0.317 | 0.33 | 0.26 | 2 |
| upper_lip_over_lower_lip | 0.776 | 0.62 | 1.3 | 0.635 | 0.62 | 0.13 | 2 |
| head_h_over_w | 1.42 | 1.45 | 0.3 | 1.476 | 1.45 | 0.26 | 2 |
| face_over_head_h | 0.551 | 0.52 | 0.78 | 0.569 | 0.53 | 0.97 | 2 |
| eye_w_over_head_w | 0.149 | 0.205 | 2.8 | 0.148 | 0.195 | 2.35 | 2 |
| **weighted mean g (measured-anthropometry rows)** | | | **1.39** | | | **1.195** | |

### Round 23 (2026-11-22): hair, facial hair and brows only

Scope: face frozen after round 22 ("Good enough, move on"). No clothes, FBX or Unity work this round. Recipe backed up to `mh/backups/recipe_00000000_before_round23.json`.

- **Step 0 refresh**: checkpoint_neutral, expressions, generated_16, f_generated_8*, f/m_lashes_game_distance re-rendered; compare measure re-run (body/face g F 1.93 / M 2.24, anthropometry g F 1.39 / M 1.20).
- **Head hair** (`mh/hair_lib.py`, 31 styles): MakeHuman CC0 hair proxies (bob, long, ponytail, braid, short01-04, afro, ...) plus per-style deformations: puff (always >= 1 now so nothing sinks into the scalp), length (lifts hair below the eyes for shorter cuts), recede (front hairline is pulled under the scalp so the skin hides it; this replaced cutting faces, which left saw-tooth edges), and scalp tint for shaved and buzz. Bald and shaved use no mesh.
- **Facial hair** (17 styles): beards are two-layer shells over head-skin faces, with tiled strand alpha (`textures/beard_strands.png`) and a faded border. They copy head weights and shape keys, so they follow jaw, lips and expressions. The talking sheet (AA/OH/EE/smile/frown) shows the mouth opening in front of the beard and not into it. The moustache band now runs from lip contact +3 to +17 mm (the old one had 4 verts). The dark corner strip on goatee and moustache was removed. Stubble is a skin tint.
- **Brows**: card alpha now has a clip (MapRange from 0.18), which removes the faint grey traces at the man's brow edges. Style, texture, gain and colour are picked per person.
- **Hair colour** (`hair_colour`): based on culture and skin tone, with greying by age. person.generate picks `_hair`, `_beard`, `_hair_col` and `_greying` per person from the seed. Men get more bald and receding styles with age, "none" is weighted 4x for beards, and men over 50 get grey variants 60% of the time.
- **Sheets** (previews/compare/mh/): hair_f.png, hair_m.png, facial_hair.png, facial_hair_talking.png, brows_grid.png, people_hair_f.png, people_hair_m.png.
- **Checks**: verify_mh VERIFY OK (94 keys, 21850 tris, seams 0). test_editor EDITOR TEST OK. Blink check: 27/28 at 0, with M Eye_Big-1 at 4 verts. The face mesh was not changed this round.
- **Still off**: the receding short, receding crop and thinning crown hairlines are smoother but still read as a hard band, and the inner shell shows at 3/4. "afro short" has small artefacts at the hairline. Moustache-only is thin. Stubble is subtle. The MH bob and shaggy cover one eye. Some women's brows read light. The editor panel has no style picker. Hair and beards are built at preview time, so they are not yet in base_mh.blend or any export.

### Round 24 (2026-11-22): hair, facial hair and brows, second pass (user-approved list of 8)

Face frozen; no clothes, FBX or Unity. Recipe backed up to `mh/backups/recipe_00000000_before_round24.json`
(round 23 hair_lib kept as `mh/backups/hair_lib_round23.py`).

1. **Receding / thinning** rebuilt as **shell hair** (`hair_lib.ShellHair`, base "cap"): 4 thin layers over the hm08 scalp faces,
   `scalp_strands.png`, a soft per-vertex density from `scalp_weight` (natural hairline curve; receding = front hairline moved
   back over the top by sagittal angle, deepest at the temples; crown = soft density dip at the whorl), outer layers sparser,
   single-sided with outward normals and backface culling (no inner side / white shards), the scalp darkened under it.
2. **Missing right brow on men**: the brow textures are painted on the eyebrow001 card layout, but men previewed on eyebrow012
   (other UVs, so one brow mapped to an empty part of the texture). Any brow style now uses the eyebrow001 card (as the
   contract build already did). Both brows show on every style.
3. **Afros**: MakeHuman's afro card is gone (grid). Afro, afro short and curly bob are now curl shells (`curl_strands.png`,
   4-9 layers, thickness that rises over 4.5 cm inside the hairline for a round, soft silhouette, soft hairline).
4. **Fringes over an eye**: `lift_fringe` gathers hair in front of the face below the brow tops onto the forehead (kept 3 mm
   off the skin), for bob, bob short, bob chin, pixie, pixie full, braid and braid short. All MakeHuman hair now gets a fine
   strand overlay along v (`hair_fine.png`: brightness, broken edges). Shaggy (still a stiff dark sweep) was dropped and
   replaced by "tousled" (a 1.3 cm shell cap), so the count stays at 31.
5. **Beards**: shells now have 4-6 layers with a clumped strand texture (`beard_clumps.png`, roots spread, tips meet), outer
   layers hang down, soft density edges, and the beard colour is the person's hair colour (no green: the old olive tints are
   gone from the palette). Grey is a mid-grey base plus white strands mixed in one by one. The moustache now covers the whole
   upper lip from the vermilion border to the nose. The hm08 lip group also includes the philtrum, which used to leave only
   the corners, so the mask now uses only the red of the lip (`vermilion()`). Stubble is a clearly darker, slightly cool
   skin shadow.
6. **Hair colour**: `PALETTE` holds natural colours (black, soft black, dark brown, brown, light brown, dark blonde, blonde,
   muted auburn, muted red), weighted by culture and tone, greying from 40 as a mix with grey-white. MakeHuman hair textures
   are normalised to their mean luminance, so the colour comes from the person and not from the texture's own tint (the old
   x2.2 on a light texture made the bright orange).
7. **Brows**: brow_bushy has more, finer strands (1900 x 1.15 px, was 1000 x 1.8). The low flat brow went up from -0.5 to
   -0.1. Brow colour = hair colour x 0.8.
8. **In the build**: `build_mh.py` bakes a **Groom** collection into base_mh.blend: 42 hidden objects (`Hair_<Style>` and
   `Beard_<Style>`) under an empty `Groom` (child of the armature), each with the shape keys that move it (Sex, Stylise, head
   shape, expressions), weights from the basemesh and Fade/Layer attributes on the shells. `export/groom.json` lists styles,
   objects, textures and shader settings. Textures are copied to export/textures (and the MakeHuman hair textures to
   export/textures/hair). The blend is saved compressed (29 MB; 108 MB uncompressed). verify_mh has new groom checks.

Checks: verify_mh VERIFY OK (body 21850 tris and 94 keys unchanged; groom 42 objects, max 11784 tris per style). test_editor
EDITOR TEST OK. Blink check: 27 of 28 at 0, with M Eye_Big-1 at 4 vertices (the same as round 23; face not touched).

Still off: the MakeHuman bob and bob chin side panels still show a hard card edge down the cheek, though both eyes are free.
The pixie and pixie full keep a smooth, slightly plastic sweep, most visible in white hair. braid01 has a pale painted patch
at the crown. Grey beards are still speckled at 3/4. Curly bob looks close to the afro. Shell hair from the front (thinning
crown, receding) reads thin against the skin. The editor panel has no style picker.
