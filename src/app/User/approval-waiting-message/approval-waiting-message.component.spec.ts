import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ApprovalWaitingMessageComponent } from './approval-waiting-message.component';

describe('ApprovalWaitingMessageComponent', () => {
  let component: ApprovalWaitingMessageComponent;
  let fixture: ComponentFixture<ApprovalWaitingMessageComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ApprovalWaitingMessageComponent]
    });
    fixture = TestBed.createComponent(ApprovalWaitingMessageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
