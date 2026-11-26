import * as Dialog from '@radix-ui/react-dialog';
import { CoursesSurface, type CourseSwitch, type CoursesSurfaceProps } from './CoursesSurface';

export type { CourseSwitch };

export interface ManageCoursesDialogProps extends Pick<CoursesSurfaceProps, 'dueCounts' | 'switched' | 'onSwitch' | 'onAddLanguage' | 'onStudy'> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCloseAutoFocus?: (event: Event) => void;
}

/**
 * The courses surface as a full-screen dialog, opened from the course switcher. The dialog only
 * mounts the surface while open, so its card counts are read once per open and its goals view
 * starts closed each time.
 */
export function ManageCoursesDialog({ open, onOpenChange, onCloseAutoFocus, ...surface }: ManageCoursesDialogProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="course-manage-overlay sf-scrim" />
      <Dialog.Content className="course-manage" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <CoursesSurface {...surface}
          renderTitle={title => <Dialog.Title className="course-manage__title">{title}</Dialog.Title>}
          renderClose={({ className, label, icon }) => <Dialog.Close className={className} aria-label={label}>{icon}</Dialog.Close>} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
